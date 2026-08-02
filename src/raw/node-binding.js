import { RAW_ASCII_SOURCE, RAW_DOCUMENT, RAW_ROOT, RAW_RUNTIME, RAW_SCHEMA, RAW_SERIALIZED, RAW_STATE, GeneratedViewBase, activeDocument, applyViewFieldWrite, disposeGeneratedView, fieldBitmapByte, fieldBitmapMask, generatedViewDocument, hasAnyViewOverlay, hasViewOverlay, initializeView, invalidateViewSerialization, materializeViewField, readViewOverlay, schemaHasComposites, setHidden, setInternal, syncViewEnumerable, writeViewOverlay } from "./view-state.js";
import { HostByteBridge, INPUT_JSON, INPUT_RAW, createNodeHostByteCodec } from "./host-byte-bridge.js";

export { RAW_ASCII_SOURCE, RAW_DOCUMENT, RAW_OVERLAY, RAW_ROOT, RAW_RUNTIME, RAW_SCHEMA, RAW_SERIALIZED, RAW_STATE, GeneratedViewBase, activeDocument, disposeGeneratedView, generatedViewDocument, hasViewOverlay, readViewOverlay, writeViewOverlay } from "./view-state.js";

const PAGE_SIZE = 64 * 1024;
const DEFAULT_CONTROL = PAGE_SIZE;
const DEFAULT_SCRATCH = PAGE_SIZE * 2;
const DEFAULT_SCRATCH_CAPACITY = 8 * 1024 * 1024;
const DEFAULT_HEAP_RESERVE = 8 * 1024 * 1024;

const STATUS_OK = 0;
const STATUS_MEMORY_EXHAUSTED = 3;
const NUMBER_SCRATCH_SIZE = 128;

const RAW_JSON = Symbol.for("json-ty.raw");
const RAW_ARRAY_OWNER = Symbol("json-ty.arrayOwner");
const STRING_IS_WELL_FORMED = String.prototype.isWellFormed;
const SURROGATE_PATTERN = /[\uD800-\uDFFF]/;

function alignPage(bytes) {
  return Math.ceil(bytes / PAGE_SIZE) * PAGE_SIZE;
}

function align8(bytes) {
  return (bytes + 7) & ~7;
}

function escapeUnpairedSurrogates(value) {
  if (STRING_IS_WELL_FORMED !== undefined ? STRING_IS_WELL_FORMED.call(value) : !SURROGATE_PATTERN.test(value)) return value;
  let output = "";
  let changed = false;
  let segment = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    if (code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        index++;
        continue;
      }
    }
    output += value.slice(segment, index) + `\\u${code.toString(16).padStart(4, "0")}`;
    segment = index + 1;
    changed = true;
  }
  return changed ? output + value.slice(segment) : value;
}

function rawJsonText(value) {
  if (value?.[RAW_JSON] !== true || typeof value.value !== "string") return undefined;
  JSON.parse(value.value);
  return value.value;
}

/** Native-compatible basic stringify plus arbitrary JSON.Raw insertion. */
function stringifyJsonValue(input) {
  const stack = new Set();
  const visit = (original, key, inArray) => {
    const directRaw = rawJsonText(original);
    if (directRaw !== undefined) return directRaw;
    let value = original;
    if (value !== null && typeof value === "object" && typeof value.toJSON === "function") {
      value = value.toJSON(key);
      const convertedRaw = rawJsonText(value);
      if (convertedRaw !== undefined) return convertedRaw;
    }
    if (value instanceof Number || value instanceof String || value instanceof Boolean) value = value.valueOf();
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
    if (typeof value === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
      return inArray ? "null" : undefined;
    }
    if (stack.has(value)) throw new TypeError("Converting circular structure to JSON");
    stack.add(value);
    try {
      if (Array.isArray(value)) {
        const items = new Array(value.length);
        for (let index = 0; index < value.length; index++) items[index] = visit(value[index], String(index), true);
        return `[${items.join(",")}]`;
      }
      const fields = [];
      for (const property of Object.keys(value)) {
        const encoded = visit(value[property], property, false);
        if (encoded !== undefined) fields.push(`${JSON.stringify(property)}:${encoded}`);
      }
      return `{${fields.join(",")}}`;
    } finally {
      stack.delete(value);
    }
  };
  return visit(input, "", false);
}

export class RawNodeBinding {
  constructor(wasm, options = {}, byteCodec = createNodeHostByteCodec(typeof Buffer === "undefined" ? undefined : Buffer)) {
    if (typeof wasm === "string") {
      throw new TypeError("Pass Wasm bytes or a WebAssembly.Module; file loading belongs to the Node application");
    }
    const bytes = wasm;
    const control = options.control ?? DEFAULT_CONTROL;
    const scratch = options.scratch ?? DEFAULT_SCRATCH;
    const scratchCapacity = options.scratchCapacity ?? DEFAULT_SCRATCH_CAPACITY;
    const heapBase = alignPage(scratch + scratchCapacity);
    const initialBytes = alignPage(heapBase + (options.heapReserve ?? DEFAULT_HEAP_RESERVE));
    const maximumPages = options.maximumPages ?? 32768;

    this.memory = new WebAssembly.Memory({
      initial: initialBytes / PAGE_SIZE,
      maximum: maximumPages,
    });
    this.control = control;
    this.scratch = scratch;
    this.scratchCapacity = scratchCapacity;
    this.heapBase = heapBase;
    this._byteBridge = new HostByteBridge(this, byteCodec);
    const module = bytes instanceof WebAssembly.Module ? bytes : new WebAssembly.Module(bytes);
    const importedMemory = this.memory;
    const bridge = this._byteBridge;
    this.instance = new WebAssembly.Instance(module, {
      env: {
        memory: importedMemory,
        parseNumberSlow(pointer, length) {
          return Number(bridge.decodeAscii(pointer, pointer + length));
        },
        abort() {
          throw new Error("Unexpected AssemblyScript abort in raw runtime");
        },
      },
    });
    this.exports = this.instance.exports;

    const status = this.exports.initialize(control, scratch, scratchCapacity, heapBase, this.memory.buffer.byteLength);
    if (status !== STATUS_OK) throw new Error(`Raw runtime initialization failed with status ${status}`);

    this._echoBytes = this.exports.echoBytes;
    this._commitBytes = this.exports.commitBytes;
    this._releaseDocument = this.exports.releaseDocument;
    this._parsers = new Map();
    this._lastParseSchema = null;
    this._lastParseTrusted = false;
    this._lastParser = null;
    this._serializers = new Map();
    this._materializers = new Map();
    this._dirtyDocuments = new Set();
    this._externalDocuments = new Map();
    this._parseDynamic = this.exports.parseDynamic;
    this._parseDynamicTrusted = this.exports.parseDynamicTrusted ?? this._parseDynamic;
    this._parseDynamicEager = this.exports.parseDynamicEager ?? this._parseDynamic;
    this._parseDynamicEagerTrusted = this.exports.parseDynamicEagerTrusted ?? this._parseDynamicEager;
    this._parseDynamicRetained = this.exports.parseDynamicRetained;
    this._parseDynamicRetainedTrusted = this.exports.parseDynamicRetainedTrusted ?? this._parseDynamicRetained;
    this._materializeDynamic = this.exports.materializeDynamic;
    this._materializeDynamicTree = this.exports.materializeDynamicTree;
    this._serializeDynamic = this.exports.serializeDynamic;
    this.objectShape = options.objectShape ?? "view";
    this._arrayFinalizer =
      typeof FinalizationRegistry === "function"
        ? new FinalizationRegistry(({ runtime, document }) => {
            try {
              runtime.release(document);
            } catch {
              /* already released */
            }
          })
        : null;
  }

  _refreshViews() {
    this._byteBridge.refreshViews();
  }

  _byteLength(value) {
    return this._byteBridge.byteLength(value);
  }

  _writeUtf8(value, offset, capacity) {
    return this._byteBridge.writeUtf8(value, offset, capacity);
  }

  _decodeUtf8(start, end) {
    return this._byteBridge.decodeUtf8(start, end);
  }

  _ensureBytes(requiredBytes) {
    this._byteBridge.ensureBytes(requiredBytes);
  }

  _result(offset) {
    return this._byteBridge.result(offset);
  }

  _callWithMemoryRefresh(operation, ...args) {
    return this._byteBridge.callWithMemoryRefresh(operation, ...args);
  }

  _invalidateScratchInput() {
    this._byteBridge.invalidateScratchInput();
  }

  _writeInput(input, requireEchoSpace = false, mode = INPUT_RAW) {
    return this._byteBridge.writeInput(input, requireEchoSpace, mode, escapeUnpairedSurrogates);
  }

  _writeRootValueInput(input) {
    return this._byteBridge.writeRootValueInput(input, escapeUnpairedSurrogates);
  }

  echo(input) {
    const length = this._writeInput(input, true);
    const status = this._echoBytes(this.scratch, length);
    if (status !== STATUS_OK) throw new Error(`Raw echo failed with status ${status}`);
    const resultOutput = this._result(20);
    const outputLength = this._result(24);
    return this._decodeUtf8(resultOutput, resultOutput + outputLength);
  }

  commit(input) {
    const length = this._writeInput(input);
    let document = this._commitBytes(this.scratch, length) >>> 0;
    if (document === 0 && this._result(0) === STATUS_MEMORY_EXHAUSTED) {
      this._ensureBytes(this._result(28));
      document = this._commitBytes(this.scratch, length) >>> 0;
    }
    if (document === 0) throw new Error(`Raw commit failed with status ${this._result(0)}`);
    return { pointer: document, length };
  }

  parse(schema, input) {
    const stringInput = typeof input === "string";
    const trustedStringInput = stringInput;
    const rootSchema = schema.root !== undefined;
    const rootArray = schema.root === "array" || schema.root === "json-array";
    const length = rootSchema ? this._writeRootValueInput(input) : this._writeInput(input, false, INPUT_JSON);
    const parserKey = `${schema.name}:${trustedStringInput ? "trusted" : "strict"}`;
    let parse = this._lastParseSchema === schema && this._lastParseTrusted === trustedStringInput ? this._lastParser : (this._parsers.get(parserKey) ?? this._parsers.get(schema.name));
    if (parse === undefined || parse === null) {
      parse = this.exports[`parse${schema.name}${trustedStringInput ? "Trusted" : ""}`] ?? this.exports[`parse${schema.name}`];
      if (typeof parse !== "function") throw new Error(`Missing parser export parse${schema.name}`);
      this._parsers.set(parserKey, parse);
    }
    this._lastParseSchema = schema;
    this._lastParseTrusted = trustedStringInput;
    this._lastParser = parse;
    let document = parse(this.scratch, length) >>> 0;
    if (document === 0 && this._result(0) === STATUS_MEMORY_EXHAUSTED) {
      this._ensureBytes(this._result(28));
      document = parse(this.scratch, length) >>> 0;
    }
    if (document === 0) {
      const status = this._result(0);
      const fault = this._result(4);
      throw new SyntaxError(`Raw parse failed with status ${status} at byte ${rootSchema ? Math.max(0, fault - 9) : fault}`);
    }
    const root = document + this._result(8);
    const residentSource = this._byteBridge.scratchInputSource;
    const asciiSource = !rootSchema && stringInput && length === residentSource.length ? residentSource : null;
    const view = new schema.View(this, document, root, asciiSource);
    if (!rootSchema) return view;
    if (!rootArray) {
      const value = view.value;
      view.dispose();
      return value;
    }
    const array = view.value;
    setHidden(array, RAW_ARRAY_OWNER, view);
    const dispose = () => {
      this._arrayFinalizer?.unregister(array);
      view.dispose();
    };
    Object.defineProperties(array, {
      dispose: { value: dispose },
      __document: { get: () => view.__document },
    });
    this._arrayFinalizer?.register(array, { runtime: this, document }, array);
    return array;
  }

  parseDynamic(input, options = {}) {
    if (options.trusted !== undefined) {
      throw new TypeError("parseDynamic trusted input is unsupported; validation is mandatory");
    }
    if (options.validate === false) {
      throw new TypeError("parseDynamic validation cannot be disabled");
    }
    if (typeof this._parseDynamic !== "function") throw new Error("Dynamic JSON was not compiled into this runtime");
    const stringInput = typeof input === "string";
    const length = this._writeInput(input, false, INPUT_JSON);
    const trustedInput = stringInput;
    // Plain values consume the complete graph immediately, so building it in
    // the parsing pass avoids deferred-container calls during materialization.
    const retained = options.plain !== true && options.eager === false;
    if (retained && typeof this._parseDynamicRetained !== "function") {
      throw new Error("Retained dynamic JSON was not compiled into this runtime");
    }
    const parseDynamic = retained
      ? trustedInput
        ? this._parseDynamicRetainedTrusted
        : this._parseDynamicRetained
      : trustedInput
        ? this._parseDynamicTrusted
        : this._parseDynamic;
    let document = this._callWithMemoryRefresh(parseDynamic, this.scratch, length) >>> 0;
    if (document === 0 && this._result(0) === STATUS_MEMORY_EXHAUSTED) {
      this._ensureBytes(this._result(28));
      document = this._callWithMemoryRefresh(parseDynamic, this.scratch, length) >>> 0;
    }
    if (document === 0) {
      throw new SyntaxError(`Raw dynamic parse failed with status ${this._result(0)} at byte ${this._result(4)}`);
    }
    const root = document + this._result(8);
    const residentSource = this._byteBridge.scratchInputSource;
    const asciiSource = stringInput && length === residentSource.length ? residentSource : null;
    const state = { document, ownsDocument: true };
    if (options.plain === true) {
      try {
        return dynamicSlotToJS(this, state, root, asciiSource);
      } finally {
        this.release(document);
        state.document = 0;
      }
    }
    const view = dynamicView(this, state, root, asciiSource);
    return view;
  }

  stringifyDynamic(value) {
    if (!(value instanceof DynamicValueView) || value.runtime !== this) {
      return stringifyJsonValue(value);
    }
    const document = value._document();
    if (value.state.serialized !== undefined) return value.state.serialized;
    const capacity = this.scratchCapacity - NUMBER_SCRATCH_SIZE;
    this._invalidateScratchInput();
    this._callWithMemoryRefresh(this._serializeDynamic, document, this.scratch, capacity);
    const status = this._result(0);
    if (status !== STATUS_OK) {
      throw new RangeError(`Raw dynamic stringify failed with status ${this._result(0)}`);
    }
    const output = this._result(20);
    const length = this._result(24);
    const result = this._decodeUtf8(output, output + length);
    value.state.serialized = result;
    return result;
  }

  stringify(schema, value) {
    if (schema.root !== undefined) {
      if (schema.root === "array" || schema.root === "json-array") {
        if (!Array.isArray(value) && !(value instanceof JsonArrayView)) {
          throw new TypeError(`Expected an array for ${schema.name}`);
        }
        const owner = value[RAW_ARRAY_OWNER];
        const wrapped = owner?.[RAW_RUNTIME] === this ? owner : { value };
        const output = this._stringifyObject(schema, wrapped);
        return output.slice(9, -1);
      }
      return this.stringifyWasm(schema, { value }).slice(9, -1);
    }
    return this._stringifyObject(schema, value);
  }

  _stringifyObject(schema, value) {
    const viewSchema = value?.[RAW_SCHEMA];
    if (value?.[RAW_RUNTIME] !== this || (viewSchema?.name ?? viewSchema) !== schema.name) {
      return schema.plainBackend === "wasm" ? this.stringifyWasm(schema, value) : this.stringifyJS(schema, value);
    }
    const document = value[RAW_DOCUMENT];
    if (document === 0) throw new ReferenceError("Cannot stringify a released JSON view");
    let requiresHostSerialization = schema.requiresHostSerialization;
    if (requiresHostSerialization === undefined) {
      requiresHostSerialization = schema.fields.some((field) => Boolean((field.decorators?.omitIf && !field.decorators?.omitIfPlan) || field.decorators?.raw || field.decorators?.codec || field.hostManaged));
      Object.defineProperty(schema, "requiresHostSerialization", { value: requiresHostSerialization, writable: true });
    }
    if (requiresHostSerialization) {
      return this.stringifyJS(schema, value);
    }
    if (hasAnyViewOverlay(value) || this._dirtyDocuments.has(document)) {
      return this.stringifyWasm(schema, value);
    }
    const state = value[RAW_STATE];
    const cached = state?.serialized ?? value[RAW_SERIALIZED];
    if (cached !== undefined && (state === undefined || state.serializedSchema === schema.name)) return cached;
    const result = this._serializeDocument(schema, document, this.scratch);
    if (state === undefined) setInternal(value, RAW_SERIALIZED, result);
    else {
      state.serialized = result;
      state.serializedSchema = schema.name;
    }
    return result;
  }

  _serializer(schema) {
    let serialize = this._serializers.get(schema.name);
    if (serialize === undefined) {
      serialize = this.exports[`serialize${schema.name}`];
      if (typeof serialize !== "function") {
        throw new Error(`Missing serializer export serialize${schema.name}`);
      }
      this._serializers.set(schema.name, serialize);
    }
    return serialize;
  }

  _materializeField(schema, state, record, field) {
    materializeViewField(this, schema, state, record, field);
  }

  _serializeDocument(schema, document, output) {
    const serialize = this._serializer(schema);
    const scratchEnd = this.scratch + this.scratchCapacity;
    const capacity = scratchEnd - NUMBER_SCRATCH_SIZE - output;
    if (capacity < 0) throw new RangeError("No operation scratch remains for JSON output");
    this._invalidateScratchInput();
    serialize(document, output, capacity);
    const status = this._result(0);
    if (status !== STATUS_OK) {
      throw new RangeError(`Raw stringify failed with status ${this._result(0)}; requires at least ${this._result(28)} bytes`);
    }
    const resultOutput = this._result(20);
    const outputLength = this._result(24);
    return this._decodeUtf8(resultOutput, resultOutput + outputLength);
  }

  _lowerPlainObject(schema, value) {
    if (value === null || typeof value !== "object") {
      throw new TypeError(`Expected an object for ${schema.name}`);
    }
    this._invalidateScratchInput();
    const document = this.scratch;
    const recordOffset = 16;
    const record = document + recordOffset;
    let cursor = align8(record + schema.recordSize);
    const limit = this.scratch + this.scratchCapacity - NUMBER_SCRATCH_SIZE;
    const registry = schema._registry ?? new Map([[schema.name, schema]]);

    const allocate = (size, alignment = 8) => {
      const pointer = (cursor + alignment - 1) & ~(alignment - 1);
      const next = pointer + size;
      if (next > limit || next < pointer) {
        throw new RangeError("Plain object ingress exceeds operation scratch capacity");
      }
      cursor = next;
      this.u8.fill(0, pointer, next);
      return pointer;
    };

    const lowerString = (destination, fieldValue) => {
      if (typeof fieldValue !== "string") throw new TypeError("Expected a string");
      const escaped = JSON.stringify(fieldValue).slice(1, -1);
      const length = this._byteLength(escaped);
      const pointer = allocate(length, 1);
      const written = this._writeUtf8(escaped, pointer, length);
      this.u32[destination >>> 2] = pointer - document;
      this.u32[(destination + 4) >>> 2] = written | 0x40000000 | (escaped === fieldValue ? 0 : 0x80000000);
    };

    const lowerArray = (type, inputArray, destination) => {
      const arrayValue = Array.isArray(inputArray) ? inputArray : inputArray instanceof JsonArrayView ? inputArray.toArray() : null;
      if (arrayValue === null) throw new TypeError("Expected an array");
      const element = type.element;
      const stride = type.elements ? 16 : element.kind === "number" || element.kind === "string" || element.kind === "union" || element.kind === "array" ? 8 : 4;
      if (type.elements && arrayValue.length !== type.elements.length) {
        throw new TypeError(`Expected a tuple of length ${type.elements.length}`);
      }
      const header = allocate(16, 8);
      const data = allocate(arrayValue.length * stride, Math.min(stride, 8));
      this.u32[header >>> 2] = element.kind === "null" ? 0 : element.kind === "number" ? 1 : element.kind === "boolean" ? 2 : element.kind === "string" ? 3 : element.kind === "object" ? 4 : 5;
      this.u32[(header + 4) >>> 2] = arrayValue.length;
      this.u32[(header + 8) >>> 2] = data - document;
      this.u32[(header + 12) >>> 2] = stride;
      this.u32[destination >>> 2] = header - document;
      this.u32[(destination + 4) >>> 2] = arrayValue.length;
      for (let index = 0; index < arrayValue.length; index++) {
        lowerValue(type.elements?.[index] ?? element, arrayValue[index], data + index * stride, `array element ${index}`);
      }
    };

    const lowerValue = (type, fieldValue, destination, label) => {
      if (type.kind === "null") {
        if (fieldValue !== null) throw new TypeError(`${label} must be null`);
      } else if (type.kind === "number") {
        if (typeof fieldValue !== "number") throw new TypeError(`${label} must be a number`);
        this.f64[destination >>> 3] = fieldValue;
      } else if (type.kind === "boolean") {
        if (typeof fieldValue !== "boolean") throw new TypeError(`${label} must be a boolean`);
        this.u32[destination >>> 2] = fieldValue ? 1 : 0;
      } else if (type.kind === "string") {
        lowerString(destination, fieldValue);
      } else if (type.kind === "object") {
        const nestedSchema = registry.get(type.typeName);
        if (!nestedSchema) throw new Error(`Missing schema ${type.typeName}`);
        const nested = allocate(nestedSchema.recordSize, 8);
        this.u32[destination >>> 2] = nested - document;
        lowerRecord(nestedSchema, fieldValue, nested);
      } else if (type.kind === "union") {
        if (fieldValue === null || typeof fieldValue !== "object") throw new TypeError(`${label} must be an object union`);
        const variantIndex = type.variants.findIndex((variant) => fieldValue[type.discriminator] === variant.discriminatorValue);
        if (variantIndex < 0) throw new TypeError(`${label} has an unknown discriminator`);
        const nestedSchema = registry.get(type.variants[variantIndex].typeName);
        if (!nestedSchema) throw new Error(`Missing schema ${type.variants[variantIndex].typeName}`);
        const nested = allocate(nestedSchema.recordSize, 8);
        this.u32[destination >>> 2] = nested - document;
        this.u32[(destination + 4) >>> 2] = variantIndex;
        lowerRecord(nestedSchema, fieldValue, nested);
      } else {
        lowerArray(type, fieldValue, destination);
      }
    };

    const lowerRecord = (recordSchema, recordValue, recordPointer) => {
      if (recordValue === null || typeof recordValue !== "object") {
        throw new TypeError(`Expected an object for ${recordSchema.name}`);
      }
      this.u8.fill(0, recordPointer, recordPointer + recordSchema.recordSize);
      for (const field of recordSchema.fields) {
        const fieldValue = recordValue[field.name];
        if (fieldValue === undefined) continue;
        const mask = fieldBitmapMask(field);
        const bitmapByte = fieldBitmapByte(field);
        this.u32[(recordPointer + bitmapByte) >>> 2] |= mask;
        const fieldType = field.type ?? { kind: field.kind };
        if (fieldValue === null && fieldType.kind !== "null") {
          if (!field.nullable) throw new TypeError(`${field.name} is not nullable`);
          this.u32[(recordPointer + recordSchema.nullOffset + bitmapByte) >>> 2] |= mask;
          continue;
        }
        lowerValue(fieldType, fieldValue, recordPointer + field.offset, field.name);
      }
    };

    lowerRecord(schema, value, record);
    this.u32[document >>> 2] = cursor - document;
    this.u32[(document + 4) >>> 2] = 0;
    this.u32[(document + 8) >>> 2] = 0;
    this.u32[(document + 12) >>> 2] = recordOffset;
    return { document, output: align8(cursor) };
  }

  stringifyWasm(schema, value) {
    const lowered = this._lowerPlainObject(schema, value);
    return this._serializeDocument(schema, lowered.document, lowered.output);
  }

  stringifyJS(schema, value) {
    if (value === null || typeof value !== "object") {
      throw new TypeError(`Expected an object for ${schema.name}`);
    }
    if (schema.nativeStringifyCompatible && value?.[RAW_RUNTIME] === undefined) return JSON.stringify(value);
    const registry = schema._registry ?? new Map([[schema.name, schema]]);
    const stack = new Set();
    const serializeValue = (type, fieldValue) => {
      if (type.kind === "object") {
        const nested = registry.get(type.typeName);
        if (!nested) throw new TypeError(`Missing schema ${type.typeName}`);
        return serializeRecord(nested, fieldValue);
      }
      if (type.kind === "union") {
        const variant = type.variants.find((item) => fieldValue?.[type.discriminator] === item.discriminatorValue);
        if (!variant) throw new TypeError("Unknown discriminated union variant");
        const nested = registry.get(variant.typeName);
        if (!nested) throw new TypeError(`Missing schema ${variant.typeName}`);
        return serializeRecord(nested, fieldValue);
      }
      if (type.kind === "array") {
        const values = Array.isArray(fieldValue) ? fieldValue : fieldValue instanceof JsonArrayView ? fieldValue.toArray() : null;
        if (values === null) throw new TypeError("Expected an array");
        if (type.elements && values.length !== type.elements.length) {
          throw new TypeError(`Expected a tuple of length ${type.elements.length}`);
        }
        return `[${values
          .map((item, index) => {
            if (item === undefined || typeof item === "function" || typeof item === "symbol") return "null";
            return serializeValue(type.elements?.[index] ?? type.element, item) ?? "null";
          })
          .join(",")}]`;
      }
      return JSON.stringify(fieldValue);
    };
    const serializeRecord = (recordSchema, recordValue) => {
      if (recordValue === null || typeof recordValue !== "object") return JSON.stringify(recordValue);
      if (stack.has(recordValue)) throw new TypeError("Converting circular structure to JSON");
      stack.add(recordValue);
      let output = "{";
      let wrote = false;
      try {
        for (const field of recordSchema.fields) {
          if (field.decorators?.omit) continue;
          const fieldValue = recordValue[field.name];
          if (fieldValue === undefined || typeof fieldValue === "function" || typeof fieldValue === "symbol") continue;
          if (fieldValue === null && field.decorators?.omitNull) continue;
          if (field.decorators?.omitIf) {
            let predicate = field._omitPredicate;
            if (predicate === undefined) {
              predicate = new Function(field.decorators.omitIfParameter ?? "self", `return (${field.decorators.omitIf});`);
              Object.defineProperty(field, "_omitPredicate", { value: predicate });
            }
            if (predicate(recordValue)) continue;
          }
          const encoded = field.decorators?.raw ? rawJsonText(fieldValue) : serializeValue(field.type ?? { kind: field.kind }, fieldValue);
          if (field.decorators?.raw && encoded === undefined) {
            throw new TypeError(`${field.name} must be a JSON.Raw value`);
          }
          if (encoded === undefined) continue;
          if (wrote) output += ",";
          output += `${JSON.stringify(field.jsonName)}:${encoded}`;
          wrote = true;
        }
        return output + "}";
      } finally {
        stack.delete(recordValue);
      }
    };
    return serializeRecord(schema, value);
  }

  read(pointer, length) {
    return this._decodeUtf8(pointer, pointer + length);
  }

  release(pointer) {
    const status = this._releaseDocument(pointer);
    if (status !== STATUS_OK) throw new Error(`Raw release failed with status ${status}`);
    if (this._dirtyDocuments.size !== 0) this._dirtyDocuments.delete(pointer);
    this._externalDocuments.delete(pointer);
  }

  _documentArenaLimit(document) {
    const external = this._externalDocuments.get(document);
    if (external !== undefined) return document + external.capacity;
    const blockSize = this.u32[(document - 8) >>> 2] & 0x7fffffff;
    return document + blockSize - 8;
  }

  parseInto(schema, source, length, output, capacity, options = {}) {
    if (!schema?.abi) throw new TypeError("Expected a compiled schema layout");
    for (const [name, value] of Object.entries({ source, length, output, capacity })) {
      if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError(`${name} must be a u32`);
    }
    if (source + length > this.memory.buffer.byteLength || output + capacity > this.memory.buffer.byteLength) {
      throw new RangeError("Input or output span exceeds WebAssembly memory");
    }
    if (source < output + capacity && output < source + length) {
      throw new RangeError("Input and output spans must not overlap");
    }
    const exportName = options.trusted ? schema.abi.parseIntoTrusted : schema.abi.parseInto;
    const parse = this.exports[exportName];
    if (typeof parse !== "function") throw new Error(`Missing parse-into export ${exportName}`);
    const document = parse(source, length, output, capacity) >>> 0;
    if (document === 0) throw new Error(`Raw parseInto failed with status ${this._result(0)}`);
    this._externalDocuments.set(document, { source, length, capacity, trusted: options.trusted === true });
    return document;
  }
}

const invalidateSerialization = invalidateViewSerialization;
export function decodeStringRef(runtime, document, pointer, asciiSource) {
  const offset = runtime.u32[pointer >>> 2];
  const rawLength = runtime.u32[(pointer + 4) >>> 2];
  const escaped = (rawLength & 0x80000000) !== 0;
  const arena = (rawLength & 0x40000000) !== 0;
  const length = rawLength & 0x3fffffff;
  const rawPointer = (document + offset) >>> 0;
  const sourceOffset = runtime.u32[(document + 4) >>> 2];
  const raw = asciiSource === null || arena ? runtime._decodeUtf8(rawPointer, rawPointer + length) : asciiSource.slice(offset - sourceOffset, offset - sourceOffset + length);
  return escaped ? decodeEscapedJsonString(raw) : raw;
}

function decodeEscapedJsonString(raw) {
  let slash = raw.indexOf("\\");
  if (slash < 0) return raw;
  let output = raw.slice(0, slash);
  let segment = slash;
  while (slash < raw.length) {
    output += raw.slice(segment, slash);
    const escape = raw.charCodeAt(slash + 1);
    if (escape === 0x75) {
      let code = 0;
      for (let index = slash + 2; index < slash + 6; index++) {
        const digit = raw.charCodeAt(index);
        code = (code << 4) | (digit <= 0x39 ? digit - 0x30 : (digit | 0x20) - 0x57);
      }
      output += String.fromCharCode(code);
      segment = slash + 6;
    } else {
      output +=
        escape === 0x22
          ? '"'
          : escape === 0x5c
            ? "\\"
            : escape === 0x2f
              ? "/"
              : escape === 0x62
                ? "\b"
                : escape === 0x66
                  ? "\f"
                  : escape === 0x6e
                    ? "\n"
                    : escape === 0x72
                      ? "\r"
                      : "\t";
      segment = slash + 2;
    }
    slash = raw.indexOf("\\", segment);
    if (slash < 0) return output + raw.slice(segment);
  }
  return output + raw.slice(segment);
}

function readArrayElement(view, type, header, index) {
  const runtime = view[RAW_RUNTIME];
  const document = activeDocument(view, "read");
  const length = runtime.u32[(header + 4) >>> 2];
  if (index < 0 || index >= length) return undefined;
  const data = document + runtime.u32[(header + 8) >>> 2];
  const stride = runtime.u32[(header + 12) >>> 2];
  const element = type.elements?.[index] ?? type.element;
  const pointer = data + index * stride;
  if (element.kind === "null") return null;
  if (element.kind === "number") return runtime.f64[pointer >>> 3];
  if (element.kind === "boolean") return runtime.u32[pointer >>> 2] !== 0;
  if (element.kind === "string") {
    return decodeStringRef(runtime, document, pointer, view[RAW_ASCII_SOURCE]);
  }
  if (element.kind === "object") {
    const nestedSchema = view[RAW_SCHEMA]._registry.get(element.typeName);
    const nestedRoot = document + runtime.u32[pointer >>> 2];
    return new nestedSchema.View(runtime, document, nestedRoot, view[RAW_ASCII_SOURCE], view[RAW_STATE], false);
  }
  if (element.kind === "union") {
    const variant = element.variants[runtime.u32[(pointer + 4) >>> 2]];
    const nestedSchema = view[RAW_SCHEMA]._registry.get(variant.typeName);
    return new nestedSchema.View(runtime, document, document + runtime.u32[pointer >>> 2], view[RAW_ASCII_SOURCE], view[RAW_STATE], false);
  }
  return materializeArray(view, element, document + runtime.u32[pointer >>> 2]);
}

function materializeArray(view, type, header) {
  if (type.facade === "json-array") return new JsonArrayView(view, type, header);
  const runtime = view[RAW_RUNTIME];
  const length = runtime.u32[(header + 4) >>> 2];
  const result = new Array(length);
  for (let index = 0; index < length; index++) result[index] = readArrayElement(view, type, header, index);
  return result;
}

function cloneJsonDefault(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneJsonDefault);
  const clone = {};
  for (const key of Object.keys(value)) clone[key] = cloneJsonDefault(value[key]);
  return clone;
}

/**
 * Composite defaults are schema constants, but JavaScript defaults must be
 * independently mutable for every parsed result. Materialize a private clone
 * on first read and route subsequent serialization through the normal overlay.
 */
function readCompositeDefault(view, field, cache) {
  if (field.defaultValue === undefined) return undefined;
  if (field.defaultValue === null || typeof field.defaultValue !== "object") {
    return field.defaultValue;
  }
  if (Object.hasOwn(view, cache)) return view[cache];
  activeDocument(view, "read");
  const value = cloneJsonDefault(field.defaultValue);
  writeViewOverlay(view, field.name, value);
  setInternal(view, cache, value);
  return value;
}

function readHostManagedField(view, field) {
  const runtime = view[RAW_RUNTIME];
  const document = activeDocument(view, "read");
  const root = view[RAW_ROOT];
  const schema = view[RAW_SCHEMA];
  const bitmapByte = fieldBitmapByte(field);
  const mask = fieldBitmapMask(field);
  if ((runtime.u32[(root + bitmapByte) >>> 2] & mask) === 0) return cloneJsonDefault(field.defaultValue);
  if ((runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] & mask) !== 0) return null;
  const type = field.type ?? { kind: field.kind };
  if (type.kind === "number") return runtime.f64[(root + field.offset) >>> 3];
  if (type.kind === "boolean") return runtime.u32[(root + field.offset) >>> 2] !== 0;
  if (type.kind === "string") {
    return decodeStringRef(runtime, document, root + field.offset, view[RAW_ASCII_SOURCE]);
  }
  if (type.kind === "array") {
    return materializeArray(view, type, document + runtime.u32[(root + field.offset) >>> 2]);
  }
  const variant = type.kind === "union" ? type.variants[runtime.u32[(root + field.offset + 4) >>> 2]] : undefined;
  const nestedSchema = view[RAW_SCHEMA]._registry.get(type.kind === "union" ? variant.typeName : type.typeName);
  return new nestedSchema.View(runtime, document, document + runtime.u32[(root + field.offset) >>> 2], view[RAW_ASCII_SOURCE], view[RAW_STATE], false);
}

export class JsonArrayView {
  constructor(owner, type, header) {
    this.owner = owner;
    this.type = type;
    this.header = header;
    this.overlay = undefined;
  }

  get length() {
    activeDocument(this.owner, "read");
    return this.owner[RAW_RUNTIME].u32[(this.header + 4) >>> 2];
  }

  at(index) {
    const normalized = index < 0 ? this.length + index : index;
    if (this.overlay?.has(normalized)) return this.overlay.get(normalized);
    return readArrayElement(this.owner, this.type, this.header, normalized);
  }

  set(index, value) {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError("JSON.Array index is out of bounds");
    }
    if (this.overlay === undefined) this.overlay = new Map();
    this.overlay.set(index, value);
    const document = activeDocument(this.owner, "write");
    this.owner[RAW_RUNTIME]._dirtyDocuments.add(document);
    invalidateSerialization(this.owner);
    return this;
  }

  *values() {
    for (let index = 0; index < this.length; index++) yield this.at(index);
  }

  [Symbol.iterator]() {
    return this.values();
  }

  toArray() {
    return Array.from(this);
  }

  dispose() {
    this.owner.dispose();
  }
}

const DYNAMIC_NULL = 0;
const DYNAMIC_BOOLEAN = 1;
const DYNAMIC_NUMBER = 2;
const DYNAMIC_STRING = 3;
const DYNAMIC_ARRAY = 4;
const DYNAMIC_OBJECT = 5;
const DYNAMIC_LAZY_ARRAY = 6;
const DYNAMIC_LAZY_OBJECT = 7;
const DYNAMIC_SLOT_PAYLOAD_OFFSET = 4;
const DYNAMIC_ARRAY_SLOT_OFFSET = 4;
const DYNAMIC_ENTRY_NEXT_OFFSET = 8;
const DYNAMIC_ENTRY_SLOT_OFFSET = 12;

function dynamicView(runtime, state, slot, asciiSource) {
  let tag = runtime.u32[slot >>> 2];
  if (tag === DYNAMIC_LAZY_ARRAY || tag === DYNAMIC_LAZY_OBJECT) {
    tag = runtime._callWithMemoryRefresh(runtime._materializeDynamic, state.document, slot) >>> 0;
    if (tag === 0) {
      throw new SyntaxError(`Deferred dynamic JSON failed to materialize at byte ${runtime._result(4)}`);
    }
  }
  if (tag === DYNAMIC_ARRAY) return new DynamicArrayView(runtime, state, slot, asciiSource);
  if (tag === DYNAMIC_OBJECT) return new DynamicObjectView(runtime, state, slot, asciiSource);
  return new DynamicValueView(runtime, state, slot, asciiSource);
}

function dynamicSlotToJS(runtime, state, slot, asciiSource) {
  const document = state.document;
  if (document === 0) {
    throw new ReferenceError("Cannot read a released dynamic JSON view");
  }
  let tag = runtime.u32[slot >>> 2];
  if (tag === DYNAMIC_LAZY_ARRAY || tag === DYNAMIC_LAZY_OBJECT) {
    tag = runtime._callWithMemoryRefresh(runtime._materializeDynamic, document, slot) >>> 0;
    if (tag === 0) {
      throw new SyntaxError(`Deferred dynamic JSON failed to materialize at byte ${runtime._result(4)}`);
    }
  }
  if (tag === DYNAMIC_NULL) return null;
  if (tag === DYNAMIC_BOOLEAN) return runtime.u32[(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET) >>> 2] !== 0;
  if (tag === DYNAMIC_NUMBER) return runtime.f64[(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET) >>> 3];
  if (tag === DYNAMIC_STRING) {
    return decodeStringRef(runtime, document, slot + DYNAMIC_SLOT_PAYLOAD_OFFSET, asciiSource);
  }

  const header = document + runtime.u32[(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET) >>> 2];
  const length = runtime.u32[header >>> 2];
  let entry = document + runtime.u32[(header + 4) >>> 2];
  if (tag === DYNAMIC_ARRAY) {
    const result = new Array(length);
    for (let index = 0; index < length; index++) {
      result[index] = dynamicSlotToJS(runtime, state, entry + DYNAMIC_ARRAY_SLOT_OFFSET, asciiSource);
      entry = document + runtime.u32[entry >>> 2];
    }
    return result;
  }
  if (tag === DYNAMIC_OBJECT) {
    const result = {};
    for (let index = 0; index < length; index++) {
      const key = decodeStringRef(runtime, document, entry, asciiSource);
      const value = dynamicSlotToJS(runtime, state, entry + DYNAMIC_ENTRY_SLOT_OFFSET, asciiSource);
      if (key === "__proto__") {
        Object.defineProperty(result, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } else {
        result[key] = value;
      }
      entry = document + runtime.u32[(entry + DYNAMIC_ENTRY_NEXT_OFFSET) >>> 2];
    }
    return result;
  }
  throw new SyntaxError(`Unknown dynamic JSON tag ${tag}`);
}

function dynamicTreeToJS(runtime, state, slot, asciiSource) {
  if (runtime._callWithMemoryRefresh(runtime._materializeDynamicTree, state.document, slot) >>> 0 === 0) {
    throw new SyntaxError(`Dynamic JSON tree failed to materialize at byte ${runtime._result(4)}`);
  }
  return dynamicSlotToJS(runtime, state, slot, asciiSource);
}

export class DynamicValueView {
  constructor(runtime, state, slot, asciiSource) {
    this.runtime = runtime;
    this.state = state;
    this.slot = slot;
    this.asciiSource = asciiSource;
  }

  _document() {
    if (this.state.document === 0) throw new ReferenceError("Cannot read a released dynamic JSON view");
    return this.state.document;
  }

  get type() {
    const tags = ["null", "boolean", "number", "string", "array", "object"];
    return tags[this.runtime.u32[this.slot >>> 2]] ?? "invalid";
  }

  get value() {
    const document = this._document();
    const tag = this.runtime.u32[this.slot >>> 2];
    if (tag === DYNAMIC_NULL) return null;
    if (tag === DYNAMIC_BOOLEAN) return this.runtime.u32[(this.slot + DYNAMIC_SLOT_PAYLOAD_OFFSET) >>> 2] !== 0;
    if (tag === DYNAMIC_NUMBER) return this.runtime.f64[(this.slot + DYNAMIC_SLOT_PAYLOAD_OFFSET) >>> 3];
    if (tag === DYNAMIC_STRING) {
      return decodeStringRef(this.runtime, document, this.slot + DYNAMIC_SLOT_PAYLOAD_OFFSET, this.asciiSource);
    }
    return this;
  }

  toJS() {
    return dynamicTreeToJS(this.runtime, this.state, this.slot, this.asciiSource);
  }

  stringify() {
    return this.runtime.stringifyDynamic(this);
  }

  dispose() {
    const document = this.state.document;
    if (document === 0) return;
    if (this.state.ownsDocument && this.slot === document + this.runtime.u32[(document + 12) >>> 2]) {
      this.runtime.release(document);
      this.state.document = 0;
    }
  }
}

export class DynamicArrayView extends DynamicValueView {
  _header() {
    const document = this._document();
    return document + this.runtime.u32[(this.slot + DYNAMIC_SLOT_PAYLOAD_OFFSET) >>> 2];
  }

  get length() {
    return this.runtime.u32[this._header() >>> 2];
  }

  _entry(index) {
    if (this._entryOffsets === undefined) {
      const document = this._document();
      const header = this._header();
      const offsets = new Array(this.runtime.u32[header >>> 2]);
      let entry = document + this.runtime.u32[(header + 4) >>> 2];
      for (let position = 0; position < offsets.length; position++) {
        offsets[position] = entry;
        entry = document + this.runtime.u32[entry >>> 2];
      }
      this._entryOffsets = offsets;
    }
    return this._entryOffsets[index];
  }

  at(index) {
    const normalized = index < 0 ? this.length + index : index;
    if (normalized < 0 || normalized >= this.length) return undefined;
    return dynamicView(this.runtime, this.state, this._entry(normalized) + DYNAMIC_ARRAY_SLOT_OFFSET, this.asciiSource);
  }

  *values() {
    for (let index = 0; index < this.length; index++) yield this.at(index);
  }

  [Symbol.iterator]() {
    return this.values();
  }

  toArray() {
    return dynamicTreeToJS(this.runtime, this.state, this.slot, this.asciiSource);
  }

  toJS() {
    return this.toArray();
  }
}

export class DynamicObjectView extends DynamicValueView {
  _header() {
    const document = this._document();
    return document + this.runtime.u32[(this.slot + DYNAMIC_SLOT_PAYLOAD_OFFSET) >>> 2];
  }

  get size() {
    return this.runtime.u32[this._header() >>> 2];
  }

  _entry(index) {
    if (this._entryOffsets === undefined) {
      const document = this._document();
      const header = this._header();
      const offsets = new Array(this.runtime.u32[header >>> 2]);
      let entry = document + this.runtime.u32[(header + 4) >>> 2];
      for (let position = 0; position < offsets.length; position++) {
        offsets[position] = entry;
        entry = document + this.runtime.u32[(entry + DYNAMIC_ENTRY_NEXT_OFFSET) >>> 2];
      }
      this._entryOffsets = offsets;
    }
    return this._entryOffsets[index];
  }

  _key(index) {
    return decodeStringRef(this.runtime, this._document(), this._entry(index), this.asciiSource);
  }

  _buildIndex() {
    if (this.index !== undefined || this.size < 8) return;
    const index = new Map();
    for (let position = 0; position < this.size; position++) index.set(this._key(position), position);
    this.index = index;
  }

  get(key) {
    this._buildIndex();
    if (this.index !== undefined) {
      const position = this.index.get(key);
      return position === undefined ? undefined : dynamicView(this.runtime, this.state, this._entry(position) + DYNAMIC_ENTRY_SLOT_OFFSET, this.asciiSource);
    }
    for (let position = this.size - 1; position >= 0; position--) {
      if (this._key(position) === key) {
        return dynamicView(this.runtime, this.state, this._entry(position) + DYNAMIC_ENTRY_SLOT_OFFSET, this.asciiSource);
      }
    }
    return undefined;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  *keys() {
    for (let position = 0; position < this.size; position++) yield this._key(position);
  }

  *entries() {
    for (let position = 0; position < this.size; position++) {
      yield [this._key(position), dynamicView(this.runtime, this.state, this._entry(position) + DYNAMIC_ENTRY_SLOT_OFFSET, this.asciiSource)];
    }
  }

  toObject() {
    return dynamicTreeToJS(this.runtime, this.state, this.slot, this.asciiSource);
  }

  toJS() {
    return this.toObject();
  }
}

const syncEnumerableProperty = syncViewEnumerable;
/** Cold compatibility hook used by emitted setters after their direct write. */
export function syncGeneratedEnumerable(view, field, present) {
  syncEnumerableProperty(view, field, present);
}

/** Clear cached serialization and the canonical-source bit after a direct write. */
export function invalidateGeneratedView(view) {
  invalidateSerialization(view);
}

export function materializeGeneratedField(view, schema, field) {
  view[RAW_RUNTIME]._materializeField(schema, view[RAW_STATE], view[RAW_ROOT], field);
}

export function readGeneratedComposite(view, schema, field, cache) {
  const document = activeDocument(view, "read");
  const runtime = view[RAW_RUNTIME];
  const root = view[RAW_ROOT];
  const mask = fieldBitmapMask(field);
  const bitmapByte = fieldBitmapByte(field);
  if ((runtime.u32[(root + bitmapByte) >>> 2] & mask) === 0) return readCompositeDefault(view, field, cache);
  if ((runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] & mask) !== 0) return null;
  if (field.decorators?.lazy) runtime._materializeField(schema, view[RAW_STATE], root, field);
  if (hasViewOverlay(view, field.name)) return readViewOverlay(view, field.name);
  if (Object.hasOwn(view, cache)) return view[cache];
  const type = field.type ?? { kind: field.kind };
  let value;
  if (type.kind === "object") {
    const nestedSchema = schema._registry.get(type.typeName);
    value = new nestedSchema.View(runtime, document, document + runtime.u32[(root + field.offset) >>> 2], view[RAW_ASCII_SOURCE], view[RAW_STATE], false);
  } else if (type.kind === "union") {
    const variant = type.variants[runtime.u32[(root + field.offset + 4) >>> 2]];
    const nestedSchema = schema._registry.get(variant.typeName);
    value = new nestedSchema.View(runtime, document, document + runtime.u32[(root + field.offset) >>> 2], view[RAW_ASCII_SOURCE], view[RAW_STATE], false);
  } else {
    value = materializeArray(view, type, document + runtime.u32[(root + field.offset) >>> 2]);
    if (type.facade !== "json-array") {
      writeViewOverlay(view, field.name, value);
    }
  }
  setInternal(view, cache, value);
  return value;
}

export function writeGeneratedField(view, schema, field, value) {
  activeDocument(view, "write");
  if (value === null && !field.nullable && field.kind !== "null") throw new TypeError(`${field.name} is not nullable`);
  if (value !== undefined && value !== null) {
    if (field.kind === "null") throw new TypeError(`${field.name} must be null`);
    if (field.kind === "number" && typeof value !== "number") throw new TypeError(`${field.name} must be a number`);
    if (field.kind === "boolean" && typeof value !== "boolean") throw new TypeError(`${field.name} must be a boolean`);
    if (field.kind === "string" && typeof value !== "string") throw new TypeError(`${field.name} must be a string`);
    if (field.kind === "array" && !Array.isArray(value) && !(value instanceof JsonArrayView)) throw new TypeError(`${field.name} must be an array`);
    if ((field.kind === "object" || field.kind === "union") && typeof value !== "object") throw new TypeError(`${field.name} must be an object`);
  }
  applyViewFieldWrite(view, schema, field, value);
}

export function createObjectView(schema, classPrototype = undefined) {
  const hasComposites = schemaHasComposites(schema);
  class RuntimeView {
    constructor(runtime, document, root, asciiSource = null, state = undefined, ownsDocument = true) {
      initializeView(this, schema, runtime, document, root, asciiSource, state, ownsDocument, hasComposites);
      if (classPrototype !== undefined) {
        for (const field of schema.fields) {
          if (field.hostManaged) Reflect.set(this, field.name, readHostManagedField(this, field));
        }
      }
    }

    dispose() {
      return disposeGeneratedView(this);
    }

    get __document() {
      return generatedViewDocument(this);
    }
  }

  for (const field of schema.fields) {
    if (field.hostManaged && classPrototype !== undefined) continue;
    const bitmapByte = fieldBitmapByte(field);
    const mask = fieldBitmapMask(field);
    const cache = field.kind === "string" || field.kind === "object" || field.kind === "array" || field.kind === "union" ? Symbol(field.name) : undefined;
    let get;
    if (field.kind === "null") {
      const read = function (view) {
        const runtime = view[RAW_RUNTIME];
        const root = view[RAW_ROOT];
        if ((runtime.u32[(root + bitmapByte) >>> 2] & mask) === 0) return field.defaultValue;
        return null;
      };
      get = hasComposites
        ? function () {
            activeDocument(this, "read");
            return read(this);
          }
        : function () {
            if (this[RAW_DOCUMENT] === 0) throw new ReferenceError("Cannot read a released JSON document");
            return read(this);
          };
    } else if (field.kind === "number" || field.kind === "boolean") {
      const read = function (view) {
        const runtime = view[RAW_RUNTIME];
        const root = view[RAW_ROOT];
        if ((runtime.u32[(root + bitmapByte) >>> 2] & mask) === 0) return field.defaultValue;
        if ((runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] & mask) !== 0) return null;
        if (field.decorators?.lazy) runtime._materializeField(schema, view[RAW_STATE], root, field);
        return field.kind === "number" ? runtime.f64[(root + field.offset) >>> 3] : runtime.u32[(root + field.offset) >>> 2] !== 0;
      };
      get = hasComposites
        ? function () {
            activeDocument(this, "read");
            return read(this);
          }
        : function () {
            if (this[RAW_DOCUMENT] === 0) throw new ReferenceError("Cannot read a released JSON document");
            return read(this);
          };
    } else if (field.kind === "string") {
      const read = function (view, document) {
        const runtime = view[RAW_RUNTIME];
        const root = view[RAW_ROOT];
        if ((runtime.u32[(root + bitmapByte) >>> 2] & mask) === 0) return field.defaultValue;
        if ((runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] & mask) !== 0) return null;
        if (hasViewOverlay(view, field.name)) return readViewOverlay(view, field.name);
        if (Object.hasOwn(view, cache)) return view[cache];
        const value = decodeStringRef(runtime, document, root + field.offset, view[RAW_ASCII_SOURCE]);
        setInternal(view, cache, value);
        return value;
      };
      get = hasComposites
        ? function () {
            return read(this, activeDocument(this, "read"));
          }
        : function () {
            const document = this[RAW_DOCUMENT];
            if (document === 0) throw new ReferenceError("Cannot read a released JSON document");
            return read(this, document);
          };
    } else {
      get = function () {
        return readGeneratedComposite(this, schema, field, cache);
      };
    }
    Object.defineProperty(RuntimeView.prototype, field.name, {
      get,
      set(value) {
        return writeGeneratedField(this, schema, field, value);
      },
      enumerable: true,
      configurable: true,
    });
  }

  Object.defineProperty(RuntimeView, "name", { value: `${schema.name}View` });
  if (classPrototype !== undefined) Object.setPrototypeOf(RuntimeView.prototype, classPrototype);
  return RuntimeView;
}
export function bindSchemaClass(schema, constructor) {
  Object.defineProperty(schema, "Class", { value: constructor, configurable: true });
  if (schema.GeneratedView !== undefined && !schema.fields.some((field) => field.hostManaged)) {
    Object.setPrototypeOf(schema.GeneratedView.prototype, constructor.prototype);
    schema.View = schema.GeneratedView;
    return schema;
  }
  schema.View = createObjectView(schema, constructor.prototype);
  return schema;
}

export function createSchemaRegistry(layouts, options = {}) {
  const registry = new Map();
  for (const layout of layouts) registry.set(layout.name, { ...layout });
  for (const schema of registry.values()) {
    Object.defineProperty(schema, "_registry", { value: registry });
    Object.defineProperty(schema, "requiresHostSerialization", {
      value: schema.fields.some((field) => Boolean((field.decorators?.omitIf && !field.decorators?.omitIfPlan) || field.decorators?.raw || field.decorators?.codec || field.hostManaged)),
      writable: true,
    });
  }
  const typeRequiresHost = (type) => {
    if (type?.kind === "object") return registry.get(type.typeName)?.requiresHostSerialization === true;
    if (type?.kind === "union") {
      return type.variants.some((variant) => registry.get(variant.typeName)?.requiresHostSerialization === true);
    }
    if (type?.kind === "array") {
      return (type.elements ?? [type.element]).some(typeRequiresHost);
    }
    return false;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const schema of registry.values()) {
      if (schema.requiresHostSerialization) continue;
      if (schema.fields.some((field) => typeRequiresHost(field.type ?? { kind: field.kind }))) {
        Object.defineProperty(schema, "requiresHostSerialization", { value: true });
        changed = true;
      }
    }
  }
  if (options.views !== false) {
    for (const schema of registry.values()) schema.View = createObjectView(schema);
  }
  return registry;
}

export function instantiateRawNodeBinding(wasm, options) {
  return new RawNodeBinding(wasm, options);
}

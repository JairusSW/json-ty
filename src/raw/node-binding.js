const PAGE_SIZE = 64 * 1024;
const DEFAULT_CONTROL = PAGE_SIZE;
const DEFAULT_SCRATCH = PAGE_SIZE * 2;
const DEFAULT_SCRATCH_CAPACITY = 8 * 1024 * 1024;
const DEFAULT_HEAP_RESERVE = 8 * 1024 * 1024;

const STATUS_OK = 0;
const STATUS_MEMORY_EXHAUSTED = 3;
const NUMBER_SCRATCH_SIZE = 128;

export const RAW_RUNTIME = Symbol("json-ty.runtime");
export const RAW_DOCUMENT = Symbol("json-ty.document");
export const RAW_ROOT = Symbol("json-ty.root");
export const RAW_SCHEMA = Symbol("json-ty.schema");
export const RAW_ASCII_SOURCE = Symbol("json-ty.asciiSource");
export const RAW_OVERLAY = Symbol("json-ty.overlay");
export const RAW_STATE = Symbol("json-ty.state");
export const RAW_SERIALIZED = Symbol("json-ty.serialized");
const RAW_JSON = Symbol.for("json-ty.raw");
const RAW_ARRAY_OWNER = Symbol("json-ty.arrayOwner");
const HAS_BUFFER = typeof Buffer !== "undefined";
const STRING_IS_WELL_FORMED = String.prototype.isWellFormed;
const SURROGATE_PATTERN = /[\uD800-\uDFFF]/;
const INPUT_RAW = 0;
const INPUT_JSON = 1;
const INPUT_ROOT_ARRAY = 2;

function alignPage(bytes) {
  return Math.ceil(bytes / PAGE_SIZE) * PAGE_SIZE;
}

function align8(bytes) {
  return (bytes + 7) & ~7;
}

function fieldBitmapByte(field) {
  return (field.index >>> 5) << 2;
}

function fieldBitmapMask(field) {
  return 1 << (field.index & 31);
}

function setHidden(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, configurable: true });
  return value;
}

function setInternal(view, key, value) {
  if (view[RAW_RUNTIME].objectShape === "enumerable") return setHidden(view, key, value);
  view[key] = value;
  return value;
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
  constructor(wasm, options = {}) {
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
    const module = bytes instanceof WebAssembly.Module ? bytes : new WebAssembly.Module(bytes);
    const importedMemory = this.memory;
    const asciiDecoder = HAS_BUFFER ? null : new TextDecoder("ascii");
    this.instance = new WebAssembly.Instance(module, {
      env: {
        memory: importedMemory,
        parseNumberSlow(pointer, length) {
          const bytes = new Uint8Array(importedMemory.buffer, pointer, length);
          return Number(HAS_BUFFER ? Buffer.from(bytes.buffer).toString("ascii", pointer, pointer + length) : asciiDecoder.decode(bytes));
        },
        abort() {
          throw new Error("Unexpected AssemblyScript abort in raw runtime");
        },
      },
    });
    this.exports = this.instance.exports;
    this.control = control;
    this.scratch = scratch;
    this.scratchCapacity = scratchCapacity;
    this.heapBase = heapBase;
    this._refreshViews();

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
    this._parseDynamic = this.exports.parseDynamic;
    this._parseDynamicTrusted = this.exports.parseDynamicTrusted ?? this._parseDynamic;
    this._serializeDynamic = this.exports.serializeDynamic;
    this.objectShape = options.objectShape ?? "view";
    this._encoder = new TextEncoder();
    this._decoder = new TextDecoder();
    this._scratchInputValid = false;
    this._scratchInputMode = INPUT_RAW;
    this._scratchInputString = null;
    this._scratchInputSource = null;
    this._scratchInputLength = 0;
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
    const buffer = this.memory.buffer;
    this.buffer = HAS_BUFFER ? Buffer.from(buffer) : null;
    this.u8 = new Uint8Array(buffer);
    this.u32 = new Uint32Array(buffer);
    this.i32 = new Int32Array(buffer);
    this.f32 = new Float32Array(buffer);
    this.f64 = new Float64Array(buffer);
  }

  _byteLength(value) {
    return HAS_BUFFER ? Buffer.byteLength(value, "utf8") : this._encoder.encode(value).byteLength;
  }

  _writeUtf8(value, offset, capacity) {
    if (this.buffer !== null) return this.buffer.write(value, offset, capacity, "utf8");
    const result = this._encoder.encodeInto(value, this.u8.subarray(offset, offset + capacity));
    if (result.read !== value.length) throw new RangeError("UTF-8 destination capacity was exhausted");
    return result.written;
  }

  _decodeUtf8(start, end) {
    return this.buffer !== null ? this.buffer.toString("utf8", start, end) : this._decoder.decode(this.u8.subarray(start, end));
  }

  _ensureBytes(requiredBytes) {
    if (requiredBytes <= this.memory.buffer.byteLength) return;
    const pages = Math.ceil((requiredBytes - this.memory.buffer.byteLength) / PAGE_SIZE);
    this.memory.grow(pages);
    this._refreshViews();
    this.exports.setHeapLimit(this.memory.buffer.byteLength);
  }

  _result(offset) {
    return this.u32[(this.control + offset) >>> 2] >>> 0;
  }

  _invalidateScratchInput() {
    if (!this._scratchInputValid) return;
    this._scratchInputValid = false;
    this._scratchInputString = null;
    this._scratchInputSource = null;
  }

  _writeInput(input, requireEchoSpace = false, mode = INPUT_RAW) {
    let length;
    if (typeof input === "string") {
      if (this._scratchInputValid && this._scratchInputMode === mode && this._scratchInputString === input) {
        if (requireEchoSpace && ((this.scratch + this._scratchInputLength + 7) & ~7) + this._scratchInputLength > this.scratch + this.scratchCapacity) {
          throw new RangeError("Input and output exceed operation scratch capacity");
        }
        return this._scratchInputLength;
      }
      const source = input;
      if (mode === INPUT_JSON) input = escapeUnpairedSurrogates(input);
      if (input.length * 3 > this.scratchCapacity) {
        const exact = this._byteLength(input);
        if (exact > this.scratchCapacity) throw new RangeError("Input exceeds operation scratch capacity");
      }
      length = this._writeUtf8(input, this.scratch, this.scratchCapacity);
      this._scratchInputValid = true;
      this._scratchInputMode = mode;
      this._scratchInputString = source;
      this._scratchInputSource = input;
      this._scratchInputLength = length;
    } else if (HAS_BUFFER && Buffer.isBuffer(input)) {
      this._invalidateScratchInput();
      length = input.length;
      if (length > this.scratchCapacity) throw new RangeError("Input exceeds operation scratch capacity");
      input.copy(this.buffer, this.scratch);
    } else if (input instanceof Uint8Array) {
      this._invalidateScratchInput();
      length = input.byteLength;
      if (length > this.scratchCapacity) throw new RangeError("Input exceeds operation scratch capacity");
      this.u8.set(input, this.scratch);
    } else {
      throw new TypeError("Expected a string, Buffer, or Uint8Array");
    }
    if (requireEchoSpace && ((this.scratch + length + 7) & ~7) + length > this.scratch + this.scratchCapacity) {
      throw new RangeError("Input and output exceed operation scratch capacity");
    }
    return length;
  }

  _writeRootArrayInput(input) {
    if (typeof input === "string" && this._scratchInputValid && this._scratchInputMode === INPUT_ROOT_ARRAY && this._scratchInputString === input) {
      return this._scratchInputLength;
    }

    const source = input;
    let length;
    if (typeof input === "string") {
      input = escapeUnpairedSurrogates(input);
      if (input.length * 3 + 10 > this.scratchCapacity) {
        const exact = this._byteLength(input);
        if (exact + 10 > this.scratchCapacity) throw new RangeError("Input exceeds operation scratch capacity");
      }
      length = this._writeUtf8(input, this.scratch + 9, this.scratchCapacity - 10);
      this._scratchInputValid = true;
      this._scratchInputMode = INPUT_ROOT_ARRAY;
      this._scratchInputString = source;
      this._scratchInputSource = input;
      this._scratchInputLength = length + 10;
    } else if (HAS_BUFFER && Buffer.isBuffer(input)) {
      this._invalidateScratchInput();
      length = input.length;
      if (length + 10 > this.scratchCapacity) throw new RangeError("Input exceeds operation scratch capacity");
      input.copy(this.buffer, this.scratch + 9);
    } else if (input instanceof Uint8Array) {
      this._invalidateScratchInput();
      length = input.byteLength;
      if (length + 10 > this.scratchCapacity) throw new RangeError("Input exceeds operation scratch capacity");
      this.u8.set(input, this.scratch + 9);
    } else {
      throw new TypeError("Expected a string, Buffer, or Uint8Array");
    }

    this.u8.set([0x7b, 0x22, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x22, 0x3a], this.scratch);
    this.u8[this.scratch + 9 + length] = 0x7d;
    return length + 10;
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
    const rootArray = schema.root !== undefined;
    const length = rootArray ? this._writeRootArrayInput(input) : this._writeInput(input, false, INPUT_JSON);
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
      throw new SyntaxError(`Raw parse failed with status ${status} at byte ${rootArray ? Math.max(0, fault - 9) : fault}`);
    }
    const root = document + this._result(8);
    const asciiSource = !rootArray && stringInput && length === this._scratchInputSource.length ? this._scratchInputSource : null;
    const view = new schema.View(this, document, root, asciiSource);
    if (!rootArray) return view;
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
    if (typeof this._parseDynamic !== "function") throw new Error("Dynamic JSON was not compiled into this runtime");
    const stringInput = typeof input === "string";
    const length = this._writeInput(input, false, INPUT_JSON);
    const parseDynamic = stringInput ? this._parseDynamicTrusted : this._parseDynamic;
    let document = parseDynamic(this.scratch, length) >>> 0;
    if (document === 0 && this._result(0) === STATUS_MEMORY_EXHAUSTED) {
      this._ensureBytes(this._result(28));
      document = parseDynamic(this.scratch, length) >>> 0;
    }
    if (document === 0) {
      throw new SyntaxError(`Raw dynamic parse failed with status ${this._result(0)} at byte ${this._result(4)}`);
    }
    const root = document + this._result(8);
    const asciiSource = stringInput && length === this._scratchInputSource.length ? this._scratchInputSource : null;
    const state = { document, ownsDocument: true };
    const view = dynamicView(this, state, root, asciiSource);
    if (!options.plain) return view;
    try {
      return view.toJS();
    } finally {
      view.dispose();
    }
  }

  stringifyDynamic(value) {
    if (!(value instanceof DynamicValueView) || value.runtime !== this) {
      return stringifyJsonValue(value);
    }
    const document = value._document();
    if (value.state.serialized !== undefined) return value.state.serialized;
    const capacity = this.scratchCapacity - NUMBER_SCRATCH_SIZE;
    this._invalidateScratchInput();
    this._serializeDynamic(document, this.scratch, capacity);
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
      if (!Array.isArray(value) && !(value instanceof JsonArrayView)) {
        throw new TypeError(`Expected an array for ${schema.name}`);
      }
      const owner = value[RAW_ARRAY_OWNER];
      const wrapped = owner?.[RAW_RUNTIME] === this ? owner : { value };
      const output = this._stringifyObject(schema, wrapped);
      return output.slice(9, -1);
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
    if (value[RAW_OVERLAY] !== undefined || this._dirtyDocuments.has(document)) {
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
    if (schema.lazyOffset === undefined) return;
    const mask = fieldBitmapMask(field);
    if ((this.u32[(record + schema.lazyOffset + fieldBitmapByte(field)) >>> 2] & mask) === 0) return;
    let materialize = this._materializers.get(schema.name);
    if (materialize === undefined) {
      materialize = this.exports[`materialize${schema.name}Field`];
      if (typeof materialize !== "function") throw new Error(`Missing lazy materializer export materialize${schema.name}Field`);
      this._materializers.set(schema.name, materialize);
    }
    const document = state.document;
    const arenaCursor = state.lazyCursor ?? (document + (this.u32[document >>> 2] & 0x7fffffff));
    const blockSize = this.u32[(document - 8) >>> 2] & 0x7fffffff;
    const arenaLimit = document + blockSize - 8;
    const next = materialize(document, record, field.index, arenaCursor, arenaLimit) >>> 0;
    if (next === 0) {
      throw new SyntaxError(`Lazy field ${schema.name}.${field.name} failed to materialize with status ${this._result(0)} at byte ${this._result(4)}`);
    }
    state.lazyCursor = next;
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
      this.u32[header >>> 2] = element.kind === "number" ? 1 : element.kind === "boolean" ? 2 : element.kind === "string" ? 3 : element.kind === "object" ? 4 : 5;
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
      if (type.kind === "number") {
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
        if (fieldValue === null) {
          if (!field.nullable) throw new TypeError(`${field.name} is not nullable`);
          this.u32[(recordPointer + recordSchema.nullOffset + bitmapByte) >>> 2] |= mask;
          continue;
        }
        lowerValue(field.type ?? { kind: field.kind }, fieldValue, recordPointer + field.offset, field.name);
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
  }
}

export function activeDocument(view, operation) {
  const state = view[RAW_STATE];
  const document = state === undefined ? view[RAW_DOCUMENT] : state.document;
  if (document === 0) throw new ReferenceError(`Cannot ${operation} a released JSON view`);
  return document;
}

function invalidateSerialization(view) {
  const state = view[RAW_STATE];
  const document = state === undefined ? view[RAW_DOCUMENT] : state.document;
  if (document !== 0) {
    // Parsed documents may retain their exact canonical UTF-8 source as a
    // serialization fast path. Any host mutation must force the generated
    // field serializer on the next stringify call.
    view[RAW_RUNTIME].u32[(document + 8) >>> 2] &= 0x0fffffff;
  }
  if (state === undefined) {
    view[RAW_SERIALIZED] = undefined;
  } else {
    state.serialized = undefined;
    state.serializedSchema = undefined;
  }
}

export function decodeStringRef(runtime, document, pointer, asciiSource) {
  const offset = runtime.u32[pointer >>> 2];
  const rawLength = runtime.u32[(pointer + 4) >>> 2];
  const escaped = (rawLength & 0x80000000) !== 0;
  const arena = (rawLength & 0x40000000) !== 0;
  const length = rawLength & 0x3fffffff;
  const raw = asciiSource === null || arena ? runtime._decodeUtf8(document + offset, document + offset + length) : asciiSource.slice(offset - 16, offset - 16 + length);
  return escaped ? globalThis.JSON.parse(`"${raw}"`) : raw;
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
  const document = activeDocument(view, "read");
  const value = cloneJsonDefault(field.defaultValue);
  let overlay = view[RAW_OVERLAY];
  if (overlay === undefined) setInternal(view, RAW_OVERLAY, (overlay = Object.create(null)));
  overlay[field.name] = value;
  view[RAW_RUNTIME]._dirtyDocuments.add(document);
  invalidateSerialization(view);
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

function dynamicView(runtime, state, slot, asciiSource) {
  const tag = runtime.u32[slot >>> 2];
  if (tag === DYNAMIC_ARRAY) return new DynamicArrayView(runtime, state, slot, asciiSource);
  if (tag === DYNAMIC_OBJECT) return new DynamicObjectView(runtime, state, slot, asciiSource);
  return new DynamicValueView(runtime, state, slot, asciiSource);
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
    if (tag === DYNAMIC_BOOLEAN) return this.runtime.u32[(this.slot + 8) >>> 2] !== 0;
    if (tag === DYNAMIC_NUMBER) return this.runtime.f64[(this.slot + 8) >>> 3];
    if (tag === DYNAMIC_STRING) {
      return decodeStringRef(this.runtime, document, this.slot + 8, this.asciiSource);
    }
    return this;
  }

  toJS() {
    return this.value;
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
    return document + this.runtime.u32[(this.slot + 8) >>> 2];
  }

  get length() {
    return this.runtime.u32[this._header() >>> 2];
  }

  at(index) {
    const normalized = index < 0 ? this.length + index : index;
    if (normalized < 0 || normalized >= this.length) return undefined;
    const document = this._document();
    const header = this._header();
    const slots = document + this.runtime.u32[(header + 4) >>> 2];
    return dynamicView(this.runtime, this.state, slots + normalized * 16, this.asciiSource);
  }

  *values() {
    for (let index = 0; index < this.length; index++) yield this.at(index);
  }

  [Symbol.iterator]() {
    return this.values();
  }

  toArray() {
    return Array.from(this, (value) => value.toJS());
  }

  toJS() {
    return this.toArray();
  }
}

export class DynamicObjectView extends DynamicValueView {
  _header() {
    const document = this._document();
    return document + this.runtime.u32[(this.slot + 8) >>> 2];
  }

  get size() {
    return this.runtime.u32[this._header() >>> 2];
  }

  _entry(index) {
    const document = this._document();
    const header = this._header();
    return document + this.runtime.u32[(header + 4) >>> 2] + index * 24;
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
      return position === undefined ? undefined : dynamicView(this.runtime, this.state, this._entry(position) + 8, this.asciiSource);
    }
    for (let position = this.size - 1; position >= 0; position--) {
      if (this._key(position) === key) {
        return dynamicView(this.runtime, this.state, this._entry(position) + 8, this.asciiSource);
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
      yield [this._key(position), dynamicView(this.runtime, this.state, this._entry(position) + 8, this.asciiSource)];
    }
  }

  toObject() {
    const result = {};
    for (const [key, value] of this.entries()) result[key] = value.toJS();
    return result;
  }

  toJS() {
    return this.toObject();
  }
}

function syncEnumerableProperty(view, field, present) {
  if (view[RAW_RUNTIME].objectShape !== "enumerable") return;
  if (!present) {
    if (Object.hasOwn(view, field.name)) delete view[field.name];
    return;
  }
  if (Object.hasOwn(view, field.name)) return;
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(view), field.name);
  if (descriptor !== undefined) Object.defineProperty(view, field.name, descriptor);
}

/** Cold compatibility hook used by emitted setters after their direct write. */
export function syncGeneratedEnumerable(view, field, present) {
  syncEnumerableProperty(view, field, present);
}

/** Clear cached serialization and the canonical-source bit after a direct write. */
export function invalidateGeneratedView(view) {
  invalidateSerialization(view);
}

function clearDeferredField(runtime, schema, root, field) {
  if (schema.lazyOffset !== undefined && field.decorators?.lazy && field.kind !== "string") {
    runtime.u32[(root + schema.lazyOffset + fieldBitmapByte(field)) >>> 2] &= ~fieldBitmapMask(field);
  }
}

function schemaHasComposites(schema) {
  return schema.hasComposites ?? (schema.hasComposites = schema.lazyOffset !== undefined || schema.fields.some((field) => field.kind === "object" || field.kind === "array" || field.kind === "union"));
}

/** Common construction only; generated projects emit every field accessor. */
export class GeneratedViewBase {
  constructor(schema, runtime, document, root, asciiSource = null, state = undefined, ownsDocument = true) {
    if (runtime.objectShape === "enumerable") {
      setHidden(this, RAW_RUNTIME, runtime);
      setHidden(this, RAW_DOCUMENT, document);
      setHidden(this, RAW_ROOT, root);
      setHidden(this, RAW_SCHEMA, schema);
      setHidden(this, RAW_ASCII_SOURCE, asciiSource);
    } else {
      this[RAW_RUNTIME] = runtime;
      this[RAW_DOCUMENT] = document;
      this[RAW_ROOT] = root;
      this[RAW_SCHEMA] = schema;
      this[RAW_ASCII_SOURCE] = asciiSource;
    }
    if (state !== undefined) {
      let localDocument = document;
      Object.defineProperty(this, RAW_DOCUMENT, {
        configurable: true,
        get() {
          return state.document === 0 ? 0 : localDocument;
        },
        set(value) {
          localDocument = value;
        },
      });
    }
    if (schemaHasComposites(schema) || state !== undefined) {
      setInternal(this, RAW_STATE, state ?? { document, ownsDocument });
      this[RAW_STATE].ownsDocument = this[RAW_STATE].ownsDocument || ownsDocument;
    }
    if (runtime.objectShape === "enumerable") {
      for (const field of schema.fields) {
        if ((runtime.u32[(root + fieldBitmapByte(field)) >>> 2] & fieldBitmapMask(field)) === 0 && field.defaultValue === undefined) continue;
        let prototype = Object.getPrototypeOf(this);
        let descriptor;
        while (prototype !== null && descriptor === undefined) {
          descriptor = Object.getOwnPropertyDescriptor(prototype, field.name);
          prototype = Object.getPrototypeOf(prototype);
        }
        if (descriptor !== undefined) Object.defineProperty(this, field.name, descriptor);
      }
    }
  }
}

export function generatedViewDocument(view) {
  return activeDocument(view, "read");
}

export function disposeGeneratedView(view) {
  const runtime = view[RAW_RUNTIME];
  const schema = view[RAW_SCHEMA];
  const hasComposites = schemaHasComposites(schema);
  if (!hasComposites) {
    const document = view[RAW_DOCUMENT];
    if (document === 0) return;
    runtime.release(document);
    view[RAW_DOCUMENT] = 0;
    view[RAW_ROOT] = 0;
    view[RAW_ASCII_SOURCE] = null;
    return;
  }
  const state = view[RAW_STATE];
  const document = state === undefined ? view[RAW_DOCUMENT] : state.document;
  if (document === 0) return;
  if (state === undefined || (state.ownsDocument && view[RAW_ROOT] === document + runtime.u32[(document + 12) >>> 2])) {
    runtime.release(document);
    if (state !== undefined) state.document = 0;
  }
  view[RAW_DOCUMENT] = 0;
  view[RAW_ROOT] = 0;
  view[RAW_ASCII_SOURCE] = null;
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
  const overlay = view[RAW_OVERLAY];
  if (overlay !== undefined && Object.hasOwn(overlay, field.name)) return overlay[field.name];
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
      let mutableOverlay = view[RAW_OVERLAY];
      if (mutableOverlay === undefined) setInternal(view, RAW_OVERLAY, (mutableOverlay = Object.create(null)));
      mutableOverlay[field.name] = value;
      runtime._dirtyDocuments.add(document);
      invalidateSerialization(view);
    }
  }
  setInternal(view, cache, value);
  return value;
}

export function writeGeneratedField(view, schema, field, value) {
  const document = activeDocument(view, "write");
  const runtime = view[RAW_RUNTIME];
  const root = view[RAW_ROOT];
  const mask = fieldBitmapMask(field);
  const bitmapByte = fieldBitmapByte(field);
  const presenceIndex = (root + bitmapByte) >>> 2;
  const nullIndex = (root + schema.nullOffset + bitmapByte) >>> 2;
  clearDeferredField(runtime, schema, root, field);
  if (value === null && !field.nullable) throw new TypeError(`${field.name} is not nullable`);
  if (value !== undefined && value !== null) {
    if (field.kind === "number" && typeof value !== "number") throw new TypeError(`${field.name} must be a number`);
    if (field.kind === "boolean" && typeof value !== "boolean") throw new TypeError(`${field.name} must be a boolean`);
    if (field.kind === "string" && typeof value !== "string") throw new TypeError(`${field.name} must be a string`);
    if (field.kind === "array" && !Array.isArray(value) && !(value instanceof JsonArrayView)) throw new TypeError(`${field.name} must be an array`);
    if ((field.kind === "object" || field.kind === "union") && typeof value !== "object") throw new TypeError(`${field.name} must be an object`);
  }
  if (field.kind === "number" || field.kind === "boolean") {
    invalidateSerialization(view);
    if (value === undefined) runtime.u32[presenceIndex] &= ~mask;
    else {
      runtime.u32[presenceIndex] |= mask;
      if (value === null) runtime.u32[nullIndex] |= mask;
      else {
        runtime.u32[nullIndex] &= ~mask;
        if (field.kind === "number") runtime.f64[(root + field.offset) >>> 3] = value;
        else runtime.u32[(root + field.offset) >>> 2] = value ? 1 : 0;
      }
    }
  } else {
    let overlay = view[RAW_OVERLAY];
    if (overlay === undefined) setInternal(view, RAW_OVERLAY, (overlay = Object.create(null)));
    overlay[field.name] = value;
    runtime._dirtyDocuments.add(document);
    invalidateSerialization(view);
    if (value === undefined) runtime.u32[presenceIndex] &= ~mask;
    else {
      runtime.u32[presenceIndex] |= mask;
      if (value === null) runtime.u32[nullIndex] |= mask;
      else runtime.u32[nullIndex] &= ~mask;
    }
  }
  syncEnumerableProperty(view, field, value !== undefined || field.defaultValue !== undefined);
}

export function createObjectView(schema, classPrototype = undefined) {
  const hasComposites = schema.lazyOffset !== undefined || schema.fields.some((field) => field.kind === "object" || field.kind === "array" || field.kind === "union");
  class GeneratedView {
    constructor(runtime, document, root, asciiSource = null, state = undefined, ownsDocument = true) {
      if (runtime.objectShape === "enumerable") {
        setHidden(this, RAW_RUNTIME, runtime);
        setHidden(this, RAW_DOCUMENT, document);
        setHidden(this, RAW_ROOT, root);
        setHidden(this, RAW_SCHEMA, schema);
        setHidden(this, RAW_ASCII_SOURCE, asciiSource);
      } else {
        this[RAW_RUNTIME] = runtime;
        this[RAW_DOCUMENT] = document;
        this[RAW_ROOT] = root;
        this[RAW_SCHEMA] = schema;
        this[RAW_ASCII_SOURCE] = asciiSource;
      }
      // A nested view may itself have a primitive-only schema. Give it a
      // document slot that follows the shared root lifetime, while keeping
      // top-level flat views on a plain data property in their hot getters.
      if (state !== undefined) {
        let localDocument = document;
        Object.defineProperty(this, RAW_DOCUMENT, {
          configurable: true,
          get() {
            return state.document === 0 ? 0 : localDocument;
          },
          set(value) {
            localDocument = value;
          },
        });
      }
      if (hasComposites || state !== undefined) {
        setInternal(this, RAW_STATE, state ?? { document, ownsDocument });
        this[RAW_STATE].ownsDocument = this[RAW_STATE].ownsDocument || ownsDocument;
      }
      if (classPrototype !== undefined) {
        for (const field of schema.fields) {
          if (field.hostManaged) Reflect.set(this, field.name, readHostManagedField(this, field));
        }
      }
      if (runtime.objectShape === "enumerable") {
        for (const field of schema.fields) {
          if (Object.hasOwn(this, field.name)) continue;
          if ((runtime.u32[(root + fieldBitmapByte(field)) >>> 2] & fieldBitmapMask(field)) === 0 && field.defaultValue === undefined) continue;
          const descriptor = Object.getOwnPropertyDescriptor(GeneratedView.prototype, field.name);
          if (descriptor !== undefined) Object.defineProperty(this, field.name, descriptor);
        }
      }
    }

    dispose() {
      if (!hasComposites) {
        const document = this[RAW_DOCUMENT];
        if (document === 0) return;
        this[RAW_RUNTIME].release(document);
        this[RAW_DOCUMENT] = 0;
        this[RAW_ROOT] = 0;
        this[RAW_ASCII_SOURCE] = null;
        return;
      }
      const state = this[RAW_STATE];
      const document = state === undefined ? this[RAW_DOCUMENT] : state.document;
      if (document === 0) return;
      if (state === undefined || (state.ownsDocument && this[RAW_ROOT] === document + this[RAW_RUNTIME].u32[(document + 12) >>> 2])) {
        this[RAW_RUNTIME].release(document);
        if (state !== undefined) state.document = 0;
      }
      this[RAW_DOCUMENT] = 0;
      this[RAW_ROOT] = 0;
      this[RAW_ASCII_SOURCE] = null;
    }

    get __document() {
      if (hasComposites) return activeDocument(this, "read");
      const document = this[RAW_DOCUMENT];
      if (document === 0) throw new ReferenceError("Cannot read a released JSON document");
      return document;
    }
  }

  for (const field of schema.fields) {
    if (field.hostManaged && classPrototype !== undefined) continue;
    const bitmapByte = fieldBitmapByte(field);
    const mask = fieldBitmapMask(field);
    let get;
    let set;
    if (field.kind === "number") {
      get = hasComposites
        ? function () {
            activeDocument(this, "read");
            const runtime = this[RAW_RUNTIME];
            const root = this[RAW_ROOT];
            if ((runtime.u32[(root + bitmapByte) >>> 2] & mask) === 0) return field.defaultValue;
            if ((runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] & mask) !== 0) return null;
            if (field.decorators?.lazy) runtime._materializeField(schema, this[RAW_STATE], root, field);
            return runtime.f64[(root + field.offset) >>> 3];
          }
        : function () {
            if (this[RAW_DOCUMENT] === 0) throw new ReferenceError("Cannot read a released JSON document");
            const runtime = this[RAW_RUNTIME];
            const root = this[RAW_ROOT];
            if ((runtime.u32[(root + bitmapByte) >>> 2] & mask) === 0) return field.defaultValue;
            if ((runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] & mask) !== 0) return null;
            return runtime.f64[(root + field.offset) >>> 3];
          };
      set = function (value) {
        if (hasComposites) activeDocument(this, "write");
        else if (this[RAW_DOCUMENT] === 0) throw new ReferenceError("Cannot write a released JSON document");
        const runtime = this[RAW_RUNTIME];
        invalidateSerialization(this);
        const root = this[RAW_ROOT];
        clearDeferredField(runtime, schema, root, field);
        if (value === undefined) {
          runtime.u32[(root + bitmapByte) >>> 2] &= ~mask;
          syncEnumerableProperty(this, field, false);
          return;
        }
        runtime.u32[(root + bitmapByte) >>> 2] |= mask;
        if (value === null) {
          if (!field.nullable) throw new TypeError(`${field.name} is not nullable`);
          runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] |= mask;
          syncEnumerableProperty(this, field, true);
          return;
        }
        if (typeof value !== "number") throw new TypeError(`${field.name} must be a number`);
        runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] &= ~mask;
        runtime.f64[(root + field.offset) >>> 3] = value;
        syncEnumerableProperty(this, field, true);
      };
    } else if (field.kind === "boolean") {
      get = hasComposites
        ? function () {
            activeDocument(this, "read");
            const runtime = this[RAW_RUNTIME];
            const root = this[RAW_ROOT];
            if ((runtime.u32[(root + bitmapByte) >>> 2] & mask) === 0) return field.defaultValue;
            if ((runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] & mask) !== 0) return null;
            if (field.decorators?.lazy) runtime._materializeField(schema, this[RAW_STATE], root, field);
            return runtime.u32[(root + field.offset) >>> 2] !== 0;
          }
        : function () {
            if (this[RAW_DOCUMENT] === 0) throw new ReferenceError("Cannot read a released JSON document");
            const runtime = this[RAW_RUNTIME];
            const root = this[RAW_ROOT];
            if ((runtime.u32[(root + bitmapByte) >>> 2] & mask) === 0) return field.defaultValue;
            if ((runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] & mask) !== 0) return null;
            return runtime.u32[(root + field.offset) >>> 2] !== 0;
          };
      set = function (value) {
        if (hasComposites) activeDocument(this, "write");
        else if (this[RAW_DOCUMENT] === 0) throw new ReferenceError("Cannot write a released JSON document");
        const runtime = this[RAW_RUNTIME];
        invalidateSerialization(this);
        const root = this[RAW_ROOT];
        clearDeferredField(runtime, schema, root, field);
        if (value === undefined) {
          runtime.u32[(root + bitmapByte) >>> 2] &= ~mask;
          syncEnumerableProperty(this, field, false);
          return;
        }
        runtime.u32[(root + bitmapByte) >>> 2] |= mask;
        if (value === null) {
          if (!field.nullable) throw new TypeError(`${field.name} is not nullable`);
          runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] |= mask;
          syncEnumerableProperty(this, field, true);
          return;
        }
        if (typeof value !== "boolean") throw new TypeError(`${field.name} must be a boolean`);
        runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] &= ~mask;
        runtime.u32[(root + field.offset) >>> 2] = value ? 1 : 0;
        syncEnumerableProperty(this, field, true);
      };
    } else if (field.kind === "string") {
      const cache = Symbol(field.name);
      const readString = function (view, document) {
        const runtime = view[RAW_RUNTIME];
        const root = view[RAW_ROOT];
        if ((runtime.u32[(root + bitmapByte) >>> 2] & mask) === 0) return field.defaultValue;
        if ((runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] & mask) !== 0) return null;
        const overlay = view[RAW_OVERLAY];
        if (overlay !== undefined && Object.hasOwn(overlay, field.name)) return overlay[field.name];
        if (Object.hasOwn(view, cache)) return view[cache];
        const value = decodeStringRef(runtime, document, root + field.offset, view[RAW_ASCII_SOURCE]);
        setInternal(view, cache, value);
        return value;
      };
      get = hasComposites
        ? function () {
            return readString(this, activeDocument(this, "read"));
          }
        : function () {
            const document = this[RAW_DOCUMENT];
            if (document === 0) throw new ReferenceError("Cannot read a released JSON document");
            return readString(this, document);
          };
      set = function (value) {
        const document = hasComposites ? activeDocument(this, "write") : this[RAW_DOCUMENT];
        if (document === 0) throw new ReferenceError("Cannot write a released JSON document");
        const runtime = this[RAW_RUNTIME];
        const root = this[RAW_ROOT];
        if (value !== undefined && value !== null && typeof value !== "string") {
          throw new TypeError(`${field.name} must be a string`);
        }
        if (value === null && !field.nullable) throw new TypeError(`${field.name} is not nullable`);
        let overlay = this[RAW_OVERLAY];
        if (overlay === undefined) setInternal(this, RAW_OVERLAY, (overlay = Object.create(null)));
        overlay[field.name] = value;
        runtime._dirtyDocuments.add(document);
        invalidateSerialization(this);
        if (value === undefined) {
          runtime.u32[(root + bitmapByte) >>> 2] &= ~mask;
        } else {
          runtime.u32[(root + bitmapByte) >>> 2] |= mask;
          if (value === null) runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] |= mask;
          else runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] &= ~mask;
        }
        syncEnumerableProperty(this, field, value !== undefined);
      };
    } else {
      const cache = Symbol(field.name);
      get = function () {
        const document = activeDocument(this, "read");
        const runtime = this[RAW_RUNTIME];
        const root = this[RAW_ROOT];
        if ((runtime.u32[(root + bitmapByte) >>> 2] & mask) === 0) return readCompositeDefault(this, field, cache);
        if ((runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] & mask) !== 0) return null;
        if (field.decorators?.lazy) runtime._materializeField(schema, this[RAW_STATE], root, field);
        const overlay = this[RAW_OVERLAY];
        if (overlay !== undefined && Object.hasOwn(overlay, field.name)) return overlay[field.name];
        if (Object.hasOwn(this, cache)) return this[cache];
        const type = field.type ?? { kind: field.kind };
        let value;
        if (type.kind === "object") {
          const nestedSchema = schema._registry.get(type.typeName);
          value = new nestedSchema.View(runtime, document, document + runtime.u32[(root + field.offset) >>> 2], this[RAW_ASCII_SOURCE], this[RAW_STATE], false);
        } else if (type.kind === "union") {
          const variant = type.variants[runtime.u32[(root + field.offset + 4) >>> 2]];
          const nestedSchema = schema._registry.get(variant.typeName);
          value = new nestedSchema.View(runtime, document, document + runtime.u32[(root + field.offset) >>> 2], this[RAW_ASCII_SOURCE], this[RAW_STATE], false);
        } else {
          value = materializeArray(this, type, document + runtime.u32[(root + field.offset) >>> 2]);
          if (type.facade !== "json-array") {
            let mutableOverlay = this[RAW_OVERLAY];
            if (mutableOverlay === undefined) setInternal(this, RAW_OVERLAY, (mutableOverlay = Object.create(null)));
            mutableOverlay[field.name] = value;
            runtime._dirtyDocuments.add(document);
            invalidateSerialization(this);
          }
        }
        setInternal(this, cache, value);
        return value;
      };
      set = function (value) {
        const document = activeDocument(this, "write");
        const runtime = this[RAW_RUNTIME];
        const root = this[RAW_ROOT];
        const type = field.type ?? { kind: field.kind };
        clearDeferredField(runtime, schema, root, field);
        if (value === null && !field.nullable) throw new TypeError(`${field.name} is not nullable`);
        if (value !== undefined && value !== null) {
          if (type.kind === "array" && !Array.isArray(value)) throw new TypeError(`${field.name} must be an array`);
          if ((type.kind === "object" || type.kind === "union") && typeof value !== "object") throw new TypeError(`${field.name} must be an object`);
        }
        let overlay = this[RAW_OVERLAY];
        if (overlay === undefined) setInternal(this, RAW_OVERLAY, (overlay = Object.create(null)));
        overlay[field.name] = value;
        runtime._dirtyDocuments.add(document);
        invalidateSerialization(this);
        if (value === undefined) runtime.u32[(root + bitmapByte) >>> 2] &= ~mask;
        else {
          runtime.u32[(root + bitmapByte) >>> 2] |= mask;
          if (value === null) runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] |= mask;
          else runtime.u32[(root + schema.nullOffset + bitmapByte) >>> 2] &= ~mask;
        }
        syncEnumerableProperty(this, field, value !== undefined);
      };
    }
    Object.defineProperty(GeneratedView.prototype, field.name, { get, set, enumerable: true, configurable: true });
  }

  Object.defineProperty(GeneratedView, "name", { value: `${schema.name}View` });
  if (classPrototype !== undefined) Object.setPrototypeOf(GeneratedView.prototype, classPrototype);
  return GeneratedView;
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

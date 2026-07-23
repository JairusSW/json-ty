export const RAW_RUNTIME = Symbol("json-ty.runtime");
export const RAW_DOCUMENT = Symbol("json-ty.document");
export const RAW_ROOT = Symbol("json-ty.root");
export const RAW_SCHEMA = Symbol("json-ty.schema");
export const RAW_ASCII_SOURCE = Symbol("json-ty.asciiSource");
export const RAW_OVERLAY = Symbol("json-ty.overlay");
export const RAW_STATE = Symbol("json-ty.state");
export const RAW_SERIALIZED = Symbol("json-ty.serialized");

export function fieldBitmapByte(field) {
  return (field.index >>> 5) << 2;
}

export function fieldBitmapMask(field) {
  return 1 << (field.index & 31);
}

export function setHidden(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, configurable: true });
  return value;
}

export function setInternal(view, key, value) {
  if (view[RAW_RUNTIME].objectShape === "enumerable") return setHidden(view, key, value);
  view[key] = value;
  return value;
}

export function activeDocument(view, operation) {
  const state = view[RAW_STATE];
  const document = state === undefined ? view[RAW_DOCUMENT] : state.document;
  if (document === 0) throw new ReferenceError(`Cannot ${operation} a released JSON view`);
  return document;
}

export function invalidateViewSerialization(view) {
  const state = view[RAW_STATE];
  const document = state === undefined ? view[RAW_DOCUMENT] : state.document;
  if (document !== 0) {
    // Parsed documents may retain their exact canonical UTF-8 source as a
    // serialization fast path. Any host mutation must force the generated
    // field serializer on the next stringify call.
    // Clear only canonical/candidate serialization state. Borrowed-source and
    // caller-owned-output lifetime flags are part of the document contract.
    view[RAW_RUNTIME].u32[(document + 8) >>> 2] &= 0x3fffffff;
  }
  if (state === undefined) {
    view[RAW_SERIALIZED] = undefined;
  } else {
    state.serialized = undefined;
    state.serializedSchema = undefined;
  }
}

export function hasViewOverlay(view, fieldName) {
  const overlay = view[RAW_OVERLAY];
  return overlay !== undefined && Object.hasOwn(overlay, fieldName);
}

export function hasAnyViewOverlay(view) {
  return view[RAW_OVERLAY] !== undefined;
}

export function readViewOverlay(view, fieldName) {
  return view[RAW_OVERLAY]?.[fieldName];
}

export function writeViewOverlay(view, fieldName, value) {
  const document = activeDocument(view, "write");
  let overlay = view[RAW_OVERLAY];
  if (overlay === undefined) setInternal(view, RAW_OVERLAY, (overlay = Object.create(null)));
  overlay[fieldName] = value;
  view[RAW_RUNTIME]._dirtyDocuments.add(document);
  invalidateViewSerialization(view);
}

/**
 * Apply one complete validated field transition. Generated and runtime-created
 * views share this invariant owner; their hot getters remain specialized.
 */
export function applyViewFieldWrite(view, schema, field, value) {
  activeDocument(view, "write");
  const runtime = view[RAW_RUNTIME];
  const root = view[RAW_ROOT];
  const mask = fieldBitmapMask(field);
  const bitmapByte = fieldBitmapByte(field);
  const presenceIndex = (root + bitmapByte) >>> 2;
  const nullIndex = (root + schema.nullOffset + bitmapByte) >>> 2;
  if (schema.lazyOffset !== undefined && field.decorators?.lazy && field.kind !== "string") {
    runtime.u32[(root + schema.lazyOffset + bitmapByte) >>> 2] &= ~mask;
  }
  if (field.kind === "number" || field.kind === "boolean" || field.kind === "null") {
    invalidateViewSerialization(view);
    if (value === undefined) {
      runtime.u32[presenceIndex] &= ~mask;
    } else {
      runtime.u32[presenceIndex] |= mask;
      if (value === null && field.kind !== "null") {
        runtime.u32[nullIndex] |= mask;
      } else {
        runtime.u32[nullIndex] &= ~mask;
        if (field.kind === "number") runtime.f64[(root + field.offset) >>> 3] = value;
        else if (field.kind === "boolean") runtime.u32[(root + field.offset) >>> 2] = value ? 1 : 0;
      }
    }
  } else {
    writeViewOverlay(view, field.name, value);
    if (value === undefined) {
      runtime.u32[presenceIndex] &= ~mask;
    } else {
      runtime.u32[presenceIndex] |= mask;
      if (value === null) runtime.u32[nullIndex] |= mask;
      else runtime.u32[nullIndex] &= ~mask;
    }
  }
  syncViewEnumerable(view, field, value !== undefined || field.defaultValue !== undefined);
}

export function materializeViewField(runtime, schema, state, record, field) {
  if (schema.lazyOffset === undefined) return;
  const mask = fieldBitmapMask(field);
  if ((runtime.u32[(record + schema.lazyOffset + fieldBitmapByte(field)) >>> 2] & mask) === 0) return;
  let materialize = runtime._materializers.get(schema.name);
  if (materialize === undefined) {
    materialize = runtime.exports[`materialize${schema.name}Field`];
    if (typeof materialize !== "function") throw new Error(`Missing lazy materializer export materialize${schema.name}Field`);
    runtime._materializers.set(schema.name, materialize);
  }
  const document = state.document;
  const arenaCursor = state.lazyCursor ?? (document + (runtime.u32[document >>> 2] & 0x7fffffff));
  const arenaLimit = runtime._documentArenaLimit(document);
  const next = materialize(document, record, field.index, arenaCursor, arenaLimit) >>> 0;
  if (next === 0) {
    throw new SyntaxError(`Lazy field ${schema.name}.${field.name} failed to materialize with status ${runtime._result(0)} at byte ${runtime._result(4)}`);
  }
  state.lazyCursor = next;
}

export function syncViewEnumerable(view, field, present) {
  if (view[RAW_RUNTIME].objectShape !== "enumerable") return;
  if (!present) {
    if (Object.hasOwn(view, field.name)) delete view[field.name];
    return;
  }
  if (Object.hasOwn(view, field.name)) return;
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(view), field.name);
  if (descriptor !== undefined) Object.defineProperty(view, field.name, descriptor);
}

export function schemaHasComposites(schema) {
  return schema.hasComposites ?? (schema.hasComposites = schema.lazyOffset !== undefined || schema.fields.some((field) => field.kind === "object" || field.kind === "array" || field.kind === "union"));
}

/** Shared construction and ownership policy for raw and generated view adapters. */
export function initializeView(view, schema, runtime, document, root, asciiSource = null, state = undefined, ownsDocument = true, hasComposites = schemaHasComposites(schema)) {
    if (runtime.objectShape === "enumerable") {
      setHidden(view, RAW_RUNTIME, runtime);
      setHidden(view, RAW_DOCUMENT, document);
      setHidden(view, RAW_ROOT, root);
      setHidden(view, RAW_SCHEMA, schema);
      setHidden(view, RAW_ASCII_SOURCE, asciiSource);
    } else {
      view[RAW_RUNTIME] = runtime;
      view[RAW_DOCUMENT] = document;
      view[RAW_ROOT] = root;
      view[RAW_SCHEMA] = schema;
      view[RAW_ASCII_SOURCE] = asciiSource;
    }
    if (state !== undefined) {
      let localDocument = document;
      Object.defineProperty(view, RAW_DOCUMENT, {
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
      setInternal(view, RAW_STATE, state ?? { document, ownsDocument });
      view[RAW_STATE].ownsDocument = view[RAW_STATE].ownsDocument || ownsDocument;
    }
    if (runtime.objectShape === "enumerable") {
      for (const field of schema.fields) {
        if ((runtime.u32[(root + fieldBitmapByte(field)) >>> 2] & fieldBitmapMask(field)) === 0 && field.defaultValue === undefined) continue;
        let prototype = Object.getPrototypeOf(view);
        let descriptor;
        while (prototype !== null && descriptor === undefined) {
          descriptor = Object.getOwnPropertyDescriptor(prototype, field.name);
          prototype = Object.getPrototypeOf(prototype);
        }
        if (descriptor !== undefined) Object.defineProperty(view, field.name, descriptor);
      }
    }
}

export class GeneratedViewBase {
  constructor(schema, runtime, document, root, asciiSource = null, state = undefined, ownsDocument = true) {
    initializeView(this, schema, runtime, document, root, asciiSource, state, ownsDocument);
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

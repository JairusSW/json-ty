import type { PrimitiveTypeRef } from "../../schema-ir.js";
import {
  bitmapMask,
  bitmapOffset,
  defaultExpression,
  propertyKey,
} from "./shared.js";
import type { HostTypeEmitter } from "./types.js";

type StringType = PrimitiveTypeRef & { kind: "string" };

export const stringHostEmitter: HostTypeEmitter<StringType> = {
  kind: "string",
  emitAccessor(_type, context) {
    const { layout, field, schemaVariable, cacheVariable } = context;
    if (!cacheVariable) throw new Error(`Missing string cache for ${layout.name}.${field.name}`);
    const mask = bitmapMask(field);
    const offset = bitmapOffset(field);
    const bitmapIndex = `(root + ${offset}) >>> 2`;
    const nullIndex = `(root + ${layout.nullOffset + offset}) >>> 2`;
    return `  get ${propertyKey(field.name)}() {
    const document = activeDocument(this, "read");
    const runtime = this[RAW_RUNTIME];
    const root = this[RAW_ROOT];
    if ((runtime.u32[(root + ${offset}) >>> 2] & ${mask}) === 0) return ${defaultExpression(field)};
    if ((runtime.u32[(root + ${layout.nullOffset + offset}) >>> 2] & ${mask}) !== 0) return null;
    if (hasViewOverlay(this, ${JSON.stringify(field.name)})) return readViewOverlay(this, ${JSON.stringify(field.name)});
    if (Object.hasOwn(this, ${cacheVariable})) return this[${cacheVariable}];
    const value = decodeStringRef(runtime, document, root + ${field.offset}, this[RAW_ASCII_SOURCE]);
    Object.defineProperty(this, ${cacheVariable}, { value, configurable: true });
    return value;
  }
  set ${propertyKey(field.name)}(value) {
    activeDocument(this, "write");
    if (value === null && ${field.nullable ? "false" : "true"}) throw new TypeError(${JSON.stringify(`${field.name} is not nullable`)});
    if (value !== undefined && value !== null && typeof value !== "string") throw new TypeError(${JSON.stringify(`${field.name} must be a string`)});
    const runtime = this[RAW_RUNTIME];
    const root = this[RAW_ROOT];
    writeViewOverlay(this, ${JSON.stringify(field.name)}, value);
    if (value === undefined) {
      runtime.u32[${bitmapIndex}] &= ~${mask};
    } else {
      runtime.u32[${bitmapIndex}] |= ${mask};
      if (value === null) runtime.u32[${nullIndex}] |= ${mask};
      else runtime.u32[${nullIndex}] &= ~${mask};
    }
    syncGeneratedEnumerable(this, ${schemaVariable}.fields[${field.index}], value !== undefined || ${field.defaultValue === undefined ? "false" : "true"});
  }`;
  },
};

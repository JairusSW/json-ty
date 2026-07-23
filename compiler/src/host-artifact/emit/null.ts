import type { PrimitiveTypeRef } from "../../schema-ir.js";
import { bitmapMask, bitmapOffset, propertyKey } from "./shared.js";
import type { HostTypeEmitter } from "./types.js";

type NullType = PrimitiveTypeRef & { kind: "null" };

export const nullHostEmitter: HostTypeEmitter<NullType> = {
  kind: "null",
  emitAccessor(_type, context) {
    const { field, schemaVariable } = context;
    const mask = bitmapMask(field);
    const offset = bitmapOffset(field);
    return `  get ${propertyKey(field.name)}() {
    activeDocument(this, "read");
    return null;
  }
  set ${propertyKey(field.name)}(value) {
    activeDocument(this, "write");
    if (value !== null) throw new TypeError(${JSON.stringify(`${field.name} must be null`)});
    const runtime = this[RAW_RUNTIME];
    const root = this[RAW_ROOT];
    invalidateGeneratedView(this);
    runtime.u32[(root + ${offset}) >>> 2] |= ${mask};
    syncGeneratedEnumerable(this, ${schemaVariable}.fields[${field.index}], true);
  }`;
  },
};

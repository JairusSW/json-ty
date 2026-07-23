import type { PrimitiveTypeRef } from "../../schema-ir.js";
import { propertyKey } from "./shared.js";
import type { HostTypeEmitter } from "./types.js";

type NullType = PrimitiveTypeRef & { kind: "null" };

export const nullHostEmitter: HostTypeEmitter<NullType> = {
  kind: "null",
  emitAccessor(_type, context) {
    const { field, schemaVariable } = context;
    return `  get ${propertyKey(field.name)}() {
    activeDocument(this, "read");
    return null;
  }
  set ${propertyKey(field.name)}(value) {
    if (value !== null) throw new TypeError(${JSON.stringify(`${field.name} must be null`)});
    writeGeneratedField(this, ${schemaVariable}, ${schemaVariable}.fields[${field.index}], value);
  }`;
  },
};

import type { HostTypeRef } from "../../schema-ir.js";
import { bitmapMask, bitmapOffset, defaultExpression, propertyKey } from "./shared.js";
import type { HostTypeEmitter } from "./types.js";

export const hostHostEmitter: HostTypeEmitter<HostTypeRef> = {
  kind: "host",
  emitAccessor(type, context) {
    const { layout, field, schemaVariable, cacheVariable } = context;
    if (!cacheVariable) throw new Error(`Missing host cache for ${layout.name}.${field.name}`);
    const mask = bitmapMask(field);
    const offset = bitmapOffset(field);
    return `  get ${propertyKey(field.name)}() {
    const document = activeDocument(this, "read");
    const runtime = this[RAW_RUNTIME];
    const root = this[RAW_ROOT];
    if ((runtime.u32[(root + ${offset}) >>> 2] & ${mask}) === 0) return ${defaultExpression(field)};
    if ((runtime.u32[(root + ${layout.nullOffset + offset}) >>> 2] & ${mask}) !== 0) return null;
    if (hasViewOverlay(this, ${JSON.stringify(field.name)})) return readViewOverlay(this, ${JSON.stringify(field.name)});
    if (Object.hasOwn(this, ${cacheVariable})) return this[${cacheVariable}];
    const value = readGeneratedHost(this, ${schemaVariable}.fields[${field.index}]);
    Object.defineProperty(this, ${cacheVariable}, { value, configurable: true });
    return value;
  }
  set ${propertyKey(field.name)}(value) {
    if (value === null && ${field.nullable ? "false" : "true"}) throw new TypeError(${JSON.stringify(`${field.name} is not nullable`)});
    writeGeneratedField(this, ${schemaVariable}, ${schemaVariable}.fields[${field.index}], value);
  }`;
  },
};

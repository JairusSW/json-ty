import type { HostFieldContext } from "./types.js";
import {
  bitmapMask,
  bitmapOffset,
  defaultExpression,
  propertyKey,
} from "./shared.js";

export function emitScalarAccessor(
  context: HostFieldContext,
  read: string,
): string {
  const { layout, field, schemaVariable } = context;
  const mask = bitmapMask(field);
  const offset = bitmapOffset(field);
  const materialize = field.decorators?.lazy && field.kind !== "string"
    ? `
    materializeGeneratedField(this, ${schemaVariable}, ${schemaVariable}.fields[${field.index}]);`
    : "";
  const expectedType = field.kind;
  return `  get ${propertyKey(field.name)}() {
    activeDocument(this, "read");
    const runtime = this[RAW_RUNTIME];
    const root = this[RAW_ROOT];
    if ((runtime.u32[(root + ${offset}) >>> 2] & ${mask}) === 0) return ${defaultExpression(field)};
    if ((runtime.u32[(root + ${layout.nullOffset + offset}) >>> 2] & ${mask}) !== 0) return null;${materialize}
    return ${read};
  }
  set ${propertyKey(field.name)}(value) {
    if (value === null && ${field.nullable ? "false" : "true"}) throw new TypeError(${JSON.stringify(`${field.name} is not nullable`)});
    if (value !== undefined && value !== null && typeof value !== ${JSON.stringify(expectedType)}) throw new TypeError(${JSON.stringify(`${field.name} must be a ${expectedType}`)});
    writeGeneratedField(this, ${schemaVariable}, ${schemaVariable}.fields[${field.index}], value);
  }`;
}

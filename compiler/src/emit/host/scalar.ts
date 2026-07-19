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
    runtime._materializeField(${schemaVariable}, this[RAW_STATE], root, ${schemaVariable}.fields[${field.index}]);`
    : "";
  const expectedType = field.kind;
  const bitmapIndex = `(root + ${offset}) >>> 2`;
  const nullIndex = `(root + ${layout.nullOffset + offset}) >>> 2`;
  const lazyClear = field.decorators?.lazy && layout.lazyOffset !== undefined
    ? `
    runtime.u32[(root + ${layout.lazyOffset + offset}) >>> 2] &= ~${mask};`
    : "";
  const write = field.kind === "number"
    ? `runtime.f64[(root + ${field.offset}) >>> 3] = value;`
    : `runtime.u32[(root + ${field.offset}) >>> 2] = value ? 1 : 0;`;
  return `  get ${propertyKey(field.name)}() {
    activeDocument(this, "read");
    const runtime = this[RAW_RUNTIME];
    const root = this[RAW_ROOT];
    if ((runtime.u32[(root + ${offset}) >>> 2] & ${mask}) === 0) return ${defaultExpression(field)};
    if ((runtime.u32[(root + ${layout.nullOffset + offset}) >>> 2] & ${mask}) !== 0) return null;${materialize}
    return ${read};
  }
  set ${propertyKey(field.name)}(value) {
    activeDocument(this, "write");
    if (value === null && ${field.nullable ? "false" : "true"}) throw new TypeError(${JSON.stringify(`${field.name} is not nullable`)});
    if (value !== undefined && value !== null && typeof value !== ${JSON.stringify(expectedType)}) throw new TypeError(${JSON.stringify(`${field.name} must be a ${expectedType}`)});
    const runtime = this[RAW_RUNTIME];
    const root = this[RAW_ROOT];${lazyClear}
    invalidateGeneratedView(this);
    if (value === undefined) {
      runtime.u32[${bitmapIndex}] &= ~${mask};
    } else {
      runtime.u32[${bitmapIndex}] |= ${mask};
      if (value === null) {
        runtime.u32[${nullIndex}] |= ${mask};
      } else {
        runtime.u32[${nullIndex}] &= ~${mask};
        ${write}
      }
    }
    syncGeneratedEnumerable(this, ${schemaVariable}.fields[${field.index}], value !== undefined || ${field.defaultValue === undefined ? "false" : "true"});
  }`;
}

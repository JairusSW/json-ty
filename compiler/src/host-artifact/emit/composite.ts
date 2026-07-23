import { propertyKey } from "./shared.js";
import type { HostFieldContext } from "./types.js";

export function emitCompositeAccessor(context: HostFieldContext): string {
  const { layout, field, schemaVariable, cacheVariable } = context;
  if (!cacheVariable) throw new Error(`Missing composite cache for ${layout.name}.${field.name}`);
  return `  get ${propertyKey(field.name)}() {
    return readGeneratedComposite(this, ${schemaVariable}, ${schemaVariable}.fields[${field.index}], ${cacheVariable});
  }
  set ${propertyKey(field.name)}(value) {
    return writeGeneratedField(this, ${schemaVariable}, ${schemaVariable}.fields[${field.index}], value);
  }`;
}


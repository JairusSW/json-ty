import { emitHostAccessor } from "./emit/host/index.js";
import type { ObjectLayout, TypeRef } from "./schema-ir.js";

/**
 * Emit real JS classes instead of constructing hot getters from descriptors at
 * application startup. Primitive and UTF-8 string fields contain fixed offsets;
 * composite fields use one shared cold materialization helper.
 */
export function generateHostViewSource(layouts: ObjectLayout[]): string {
  return layouts
    .map((layout, schemaIndex) => {
      const schemaVariable = `schema${schemaIndex}`;
      const caches = new Map<number, string>();
      for (const field of layout.fields) if (field.kind === "string" || field.kind === "object" || field.kind === "array" || field.kind === "union") caches.set(field.index, `${schemaVariable}Cache${field.index}`);
      const cacheDeclarations = [...caches.values()].map((name) => `const ${name} = Symbol();`).join("\n");
      const getters = layout.fields
        .map((field) => emitHostAccessor(
          field.type ?? ({ kind: field.kind } as TypeRef),
          {
            layout,
            field,
            schemaVariable,
            cacheVariable: caches.get(field.index),
          },
        ))
        .join("\n");
      return `${cacheDeclarations}
class ${layout.name}HostView extends GeneratedViewBase {
  constructor(runtime, document, root, asciiSource = null, state = undefined, ownsDocument = true) {
    super(${schemaVariable}, runtime, document, root, asciiSource, state, ownsDocument);
  }
  dispose() {
    return disposeGeneratedView(this);
  }
  get __document() {
    return generatedViewDocument(this);
  }
${getters}
}
Object.defineProperties(${schemaVariable}, {
  GeneratedView: { value: ${layout.name}HostView, configurable: true },
  GeneratedViewBase: { value: GeneratedViewBase, configurable: true },
});
${schemaVariable}.View = ${layout.name}HostView;`;
    })
    .join("\n");
}

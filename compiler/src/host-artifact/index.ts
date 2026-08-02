import { emitHostAccessor } from "./emit/index.js";
import type { ObjectLayout, TypeRef } from "../schema-ir.js";

export interface HostArtifact {
  source: string;
  schemaBindings: Readonly<Record<string, { parse: string; stringify: string }>>;
}

function emitViewClasses(layouts: ObjectLayout[]): string {
  return layouts
    .map((layout, schemaIndex) => {
      const schemaVariable = `schema${schemaIndex}`;
      const caches = new Map<number, string>();
      for (const field of layout.fields) {
        if (field.kind === "string" || field.kind === "object" || field.kind === "array" || field.kind === "union") {
          caches.set(field.index, `${schemaVariable}Cache${field.index}`);
        }
      }
      const cacheDeclarations = [...caches.values()].map((name) => `const ${name} = Symbol();`).join("\n");
      const getters = layout.fields
        .map((field) =>
          emitHostAccessor(field.type ?? ({ kind: field.kind } as TypeRef), {
            layout,
            field,
            schemaVariable,
            cacheVariable: caches.get(field.index),
          }),
        )
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

function bindingTarget(layout: ObjectLayout, schemaVariable: string): string {
  const fieldType = layout.fields[0]?.type;
  const element = fieldType?.kind === "array" ? fieldType.element : undefined;
  if (!layout.root) return schemaVariable;
  const targetName = element?.kind === "object" ? element.typeName : "";
  return `${schemaVariable}._registry.get(${JSON.stringify(targetName)})`;
}

function emitSchemaBindings(layouts: ObjectLayout[]): string {
  return layouts
    .map((layout, index) => {
      const schemaVariable = `schema${index}`;
      return `binding._parsers.set(${JSON.stringify(layout.name)}, binding.exports.${layout.abi!.parse});
binding._parsers.set(${JSON.stringify(`${layout.name}:strict`)}, binding.exports.${layout.abi!.parse});
binding._parsers.set(${JSON.stringify(`${layout.name}:trusted`)}, binding.exports.${layout.abi!.parseTrusted});
binding._serializers.set(${JSON.stringify(layout.name)}, binding.exports.${layout.abi!.serialize});
${layout.abi!.materialize ? `binding._materializers.set(${JSON.stringify(layout.name)}, binding.exports.${layout.abi!.materialize});` : ""}
export const ${layout.abi!.parse} = (input, constructor) => {
  const target = ${bindingTarget(layout, schemaVariable)};
  if (constructor && target && target.Class !== constructor) bindSchemaClass(target, constructor);
  return binding.parse(${schemaVariable}, input);
};
export const ${layout.abi!.serialize} = (value) => binding.stringify(${schemaVariable}, value);
__jsonTyRuntime.${`parse${layout.name}`} = ${layout.abi!.parse};
__jsonTyRuntime.${`stringify${layout.name}`} = ${layout.abi!.serialize};`;
    })
    .join("\n");
}

/** Generate the complete JavaScript artifact consumed by transformed applications. */
export function generateHostArtifact(layouts: ObjectLayout[]): HostArtifact {
  const schemaDeclarations = layouts.map((layout, index) => `const schema${index} = schemas.get(${JSON.stringify(layout.name)});`).join("\n");
  const source = `import {
  RAW_ASCII_SOURCE,
  RAW_ROOT,
  RAW_RUNTIME,
  GeneratedViewBase,
  instantiateRawBinding,
  activeDocument,
  bindSchemaClass,
  createSchemaRegistry,
  decodeStringRef,
  disposeGeneratedView,
  generatedViewDocument,
  hasViewOverlay,
  materializeGeneratedField,
  readViewOverlay,
  readGeneratedComposite,
  writeGeneratedField,
} from "json-ty/raw";

const binding = await instantiateRawBinding(new URL("./runtime.wasm", import.meta.url));
export const schemas = createSchemaRegistry(${JSON.stringify(layouts)}, { views: false });
${schemaDeclarations}
${emitViewClasses(layouts)}
export const __jsonTyRuntime = {
  binding,
  schemas,
  parseDynamic(input) {
    return binding.parseDynamic(input);
  },
  stringifyDynamic(value) {
    return binding.stringifyDynamic(value);
  },
};
${emitSchemaBindings(layouts)}
`;

  return {
    source,
    schemaBindings: Object.fromEntries(layouts.map((layout) => [layout.name, { parse: layout.abi!.parse, stringify: layout.abi!.serialize }])),
  };
}

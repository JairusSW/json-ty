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
        if (field.kind === "string" || field.kind === "object" || field.kind === "array" || field.kind === "union" || field.kind === "host") {
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

function canEmitPlainProjection(layout: ObjectLayout): boolean {
  return !layout.nativeStringifyCompatible && layout.fields.every((field) =>
    (field.kind === "number" || field.kind === "boolean" || field.kind === "string" || field.kind === "null") &&
    field.jsonName !== "__proto__" && field.jsonName !== "toJSON" &&
    !field.decorators?.raw && !field.decorators?.codec && !field.decorators?.omitIf && !field.hostManaged
  );
}

function emitPlainStringifiers(layouts: ObjectLayout[]): string {
  return layouts
    .map((layout, index) => {
      if (!canEmitPlainProjection(layout)) return "";
      const schemaVariable = `schema${index}`;
      const functionName = `stringify${layout.name}Plain`;
      const fields = layout.fields
        .filter((field) => !field.decorators?.omit)
        .map((field) => {
          const value = `value[${JSON.stringify(field.name)}]`;
          const condition = field.decorators?.omitNull
            ? `${value} !== undefined && ${value} !== null`
            : `${value} !== undefined`;
          return `  if (${condition}) output[${JSON.stringify(field.jsonName)}] = ${value};`;
        })
        .join("\n");
      return `function ${functionName}(value) {
  if (value === null || typeof value !== "object") throw new TypeError(${JSON.stringify(`Expected an object for ${layout.name}`)});
  const output = {};
${fields}
  return JSON.stringify(output);
}
Object.defineProperty(${schemaVariable}, "_plainStringifier", { value: ${functionName} });`;
    })
    .filter(Boolean)
    .join("\n");
}

function bindingTarget(layout: ObjectLayout, schemaVariable: string): string {
  const fieldType = layout.fields[0]?.type;
  const element = fieldType?.kind === "array" ? fieldType.element : undefined;
  if (!layout.root) return schemaVariable;
  const targetName = element?.kind === "object"
    ? element.typeName
    : fieldType?.kind === "host" && fieldType.codec.kind === "custom"
      ? fieldType.codec.typeName
      : "";
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
export const ${layout.abi!.parse} = (input, outOrConstructor, constructor) => {
  const target = ${bindingTarget(layout, schemaVariable)};
  const classConstructor = constructor ?? (typeof outOrConstructor === "function" ? outOrConstructor : undefined);
  if (classConstructor && target && target.Class !== classConstructor) bindSchemaClass(target, classConstructor);
  const parsed = binding.parse(${schemaVariable}, input);
  return typeof outOrConstructor === "function" || outOrConstructor == null
    ? parsed
    : binding.reuse(${schemaVariable}, outOrConstructor, parsed);
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
  readGeneratedHost,
  writeGeneratedField,
} from "json-ty/raw";

const binding = await instantiateRawBinding(new URL("./runtime.wasm", import.meta.url));
export const schemas = createSchemaRegistry(${JSON.stringify(layouts)}, { views: false });
${schemaDeclarations}
${emitViewClasses(layouts)}
${emitPlainStringifiers(layouts)}
export const __jsonTyRuntime = {
  binding,
  schemas,
  parseDynamic(input, options) {
    return binding.parseDynamic(input, options);
  },
  stringifyDynamic(value) {
    return binding.stringifyDynamic(value);
  },
};
export const registerSchemaClass = (name, constructor) => {
  const schema = schemas.get(name);
  if (!schema) throw new ReferenceError("Unknown generated schema " + name);
  bindSchemaClass(schema, constructor);
  const codec = schema.root === "value" && schema.fields[0]?.type?.kind === "host" ? schema.fields[0].type.codec : undefined;
  if (codec?.kind === "custom") Object.defineProperty(constructor.prototype, Symbol.for("json-ty.custom-codec"), { value: codec, configurable: true });
};
${emitSchemaBindings(layouts)}
`;

  return {
    source,
    schemaBindings: Object.fromEntries(layouts.map((layout) => [layout.name, { parse: layout.abi!.parse, stringify: layout.abi!.serialize }])),
  };
}

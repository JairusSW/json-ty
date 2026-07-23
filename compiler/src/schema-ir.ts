import { createHash } from "node:crypto";

export const SCHEMA_IR_VERSION = 5;

export type LazyMode = "none" | "auto" | "all";

export type PrimitiveFieldKind = "number" | "boolean" | "string";

export interface PrimitiveTypeRef {
  kind: PrimitiveFieldKind;
}

export interface ObjectTypeRef {
  kind: "object";
  typeName: string;
}

export interface ArrayTypeRef {
  kind: "array";
  element: TypeRef;
  /** Present for fixed heterogeneous tuples. */
  elements?: TypeRef[];
  facade?: "array" | "json-array";
}

export interface UnionVariantRef {
  typeName: string;
  discriminatorValue: string | number | boolean;
}

export interface UnionTypeRef {
  kind: "union";
  discriminator: string;
  variants: UnionVariantRef[];
}

export type TypeRef = PrimitiveTypeRef | ObjectTypeRef | ArrayTypeRef | UnionTypeRef;

/** JSON-compatible compile-time initializer retained as an immutable schema constant. */
export type JsonDefault =
  | string
  | number
  | boolean
  | null
  | JsonDefault[]
  | { readonly [key: string]: JsonDefault };

export type OmitIfExpression =
  | { kind: "literal"; value: number | boolean }
  | { kind: "field"; name: string }
  | { kind: "unary"; operator: "!" | "+" | "-"; operand: OmitIfExpression }
  | {
      kind: "binary";
      operator: "+" | "-" | "*" | "/" | "%" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "&&" | "||";
      left: OmitIfExpression;
      right: OmitIfExpression;
    };

export interface FieldDecorators {
  alias?: string;
  omit?: boolean;
  omitNull?: boolean;
  omitIf?: string;
  omitIfParameter?: string;
  omitIfPlan?: OmitIfExpression;
  optional?: boolean;
  lazy?: boolean;
  eager?: boolean;
  raw?: boolean;
  codec?: string;
}

export interface SchemaField {
  name: string;
  jsonName?: string;
  kind: TypeRef["kind"];
  type?: TypeRef;
  nullable?: boolean;
  optional?: boolean;
  defaultValue?: JsonDefault;
  decorators?: FieldDecorators;
  hostManaged?: boolean;
}

export interface ObjectSchema {
  name: string;
  root?: "array" | "json-array";
  fields: SchemaField[];
  sourceFile?: string;
  declarationKind?: "class" | "interface" | "type";
  decorators?: {
    json?: boolean;
    lazyMode?: LazyMode;
    strict?: boolean;
  };
}

export type FieldLayout = SchemaField & { index: number; offset: number };

/** The generated parser protocol is selected once by the compiler, never at runtime. */
export interface DeserializeTierPlan {
  /** Exact compact default-document match. */
  defaultDocument: boolean;
  /** Declaration-order, no-whitespace hot path. */
  canonical: boolean;
  /** Declaration-order path which probes optional/defaulted fields. */
  canonicalOptional: boolean;
  /** Declaration-order path with JSON whitespace. */
  whitespace: boolean;
  /** Arbitrary-order packed-key dispatch. */
  keyed: boolean;
  /** Fully validating generated grammar fallback. */
  slow: true;
  /** Split very wide straight-line parsers into optimizer-safe helpers. */
  chunkSize?: number;
}

export interface LayoutFeaturePlan {
  deserialize: DeserializeTierPlan;
  retainsSource: boolean;
  hasLazyFields: boolean;
  fullWrite: boolean;
  simdKeys: boolean;
  defaults: "none" | "delta";
}

/** Short stable Wasm export names; the generated host module owns friendly names. */
export interface SchemaAbi {
  index: number;
  parse: string;
  parseTrusted: string;
  parseInto: string;
  parseIntoTrusted: string;
  serialize: string;
  materialize?: string;
}

export interface ObjectLayout {
  name: string;
  root?: "array" | "json-array";
  recordSize: number;
  bitmapWords: number;
  /** Byte offset of the first null-bitmap word. */
  nullOffset: number;
  /** Byte offset of the first fixed-width field slot. */
  fieldOffset: number;
  /** Byte offset of the deferred-field bitmap, when this record has one. */
  lazyOffset?: number;
  fields: FieldLayout[];
  nativeStringifyCompatible: boolean;
  features: LayoutFeaturePlan;
  abi?: SchemaAbi;
}

export interface SchemaManifest {
  version: number;
  schemas: ObjectSchema[];
  hash: string;
}

export function layoutObject(schema: ObjectSchema): ObjectLayout {
  if (!/^[$A-Z_a-z][$\w]*$/.test(schema.name)) {
    throw new Error(`Invalid schema name ${JSON.stringify(schema.name)}`);
  }
  const bitmapWords = Math.max(1, Math.ceil(schema.fields.length / 32));
  const nullOffset = bitmapWords * 4;
  const fieldOffset = bitmapWords * 8;
  const seen = new Set<string>();
  const fields = schema.fields.map((field, index): FieldLayout => {
    const jsonName = field.jsonName ?? field.name;
    if (seen.has(jsonName)) throw new Error(`Duplicate JSON field ${JSON.stringify(jsonName)}`);
    seen.add(jsonName);
    const type = field.type ?? ({ kind: field.kind } as TypeRef);
    return { ...field, type, jsonName, index, offset: fieldOffset + index * 8 };
  });
  const hasDeferredFields = fields.some((field) => field.decorators?.lazy && field.kind !== "string");
  const fieldsEnd = fieldOffset + fields.length * 8;
  const lazyOffset = hasDeferredFields ? fieldsEnd : undefined;
  const recordEnd = fieldsEnd + (hasDeferredFields ? bitmapWords * 4 : 0);
  const recordSize = (recordEnd + 7) & ~7;
  const hasDefaults = fields.some((field) => field.defaultValue !== undefined);
  const canMatchDefaultDocument = hasDefaults && fields.every((field) => !field.hostManaged && !field.decorators?.omitIf && !field.decorators?.raw && !field.decorators?.codec);
  const hasOptionalShape = fields.some((field) => field.optional || field.defaultValue !== undefined || field.decorators?.optional);
  const retainsSource = fields.some((field) => field.kind === "string" || field.decorators?.lazy);
  const fullWrite = fields.length !== 0 && fields.every((field) => !field.optional && field.defaultValue === undefined && !field.decorators?.optional);
  return {
    name: schema.name,
    ...(schema.root ? { root: schema.root } : {}),
    bitmapWords,
    nullOffset,
    fieldOffset,
    fields,
    ...(lazyOffset === undefined ? {} : { lazyOffset }),
    recordSize,
    nativeStringifyCompatible: fields.every((field) => field.jsonName === field.name && !field.decorators?.omit && !field.decorators?.omitNull && !field.decorators?.omitIf && !field.decorators?.raw && !field.decorators?.codec),
    features: {
      deserialize: {
        defaultDocument: canMatchDefaultDocument,
        canonical: fields.length !== 0,
        canonicalOptional: hasOptionalShape,
        whitespace: fields.length !== 0,
        keyed: fields.length !== 0,
        slow: true,
        ...(fields.length > 32
          ? { chunkSize: 32 }
          : {}),
      },
      retainsSource,
      hasLazyFields: hasDeferredFields,
      fullWrite,
      simdKeys: fields.some((field) => new TextEncoder().encode(field.jsonName!).length >= 8),
      defaults: hasDefaults ? "delta" : "none",
    },
  };
}

export function canonicalizeSchemas(schemas: ObjectSchema[]): ObjectSchema[] {
  return [...schemas]
    .map((schema) => ({
      ...schema,
      fields: schema.fields.map((field) => ({ ...field })),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function createSchemaManifest(schemas: ObjectSchema[]): SchemaManifest {
  const canonical = canonicalizeSchemas(schemas);
  const semanticSchemas = canonical.map(({ sourceFile: _sourceFile, ...schema }) => schema);
  const payload = JSON.stringify({ version: SCHEMA_IR_VERSION, schemas: semanticSchemas });
  return {
    version: SCHEMA_IR_VERSION,
    schemas: canonical,
    hash: createHash("sha256").update(payload).digest("hex"),
  };
}

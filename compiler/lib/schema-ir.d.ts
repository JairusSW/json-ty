export declare const SCHEMA_IR_VERSION = 5;
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
export type JsonDefault = string | number | boolean | null | JsonDefault[] | {
    readonly [key: string]: JsonDefault;
};
export type OmitIfExpression = {
    kind: "literal";
    value: number | boolean;
} | {
    kind: "field";
    name: string;
} | {
    kind: "unary";
    operator: "!" | "+" | "-";
    operand: OmitIfExpression;
} | {
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
export type FieldLayout = SchemaField & {
    index: number;
    offset: number;
};
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
export declare function layoutObject(schema: ObjectSchema): ObjectLayout;
export declare function canonicalizeSchemas(schemas: ObjectSchema[]): ObjectSchema[];
export declare function createSchemaManifest(schemas: ObjectSchema[]): SchemaManifest;

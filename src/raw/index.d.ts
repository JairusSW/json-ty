export type PrimitiveTypeRef = { kind: "number" | "boolean" | "string" | "null" };
export interface ObjectTypeRef {
  kind: "object";
  typeName: string;
}
export interface ArrayTypeRef {
  kind: "array";
  element: FieldTypeRef;
  facade?: "array" | "json-array";
  elements?: FieldTypeRef[];
}
export interface UnionTypeRef {
  kind: "union";
  discriminator: string;
  variants: Array<{ typeName: string; discriminatorValue: string | number | boolean }>;
}
export type FieldTypeRef = PrimitiveTypeRef | ObjectTypeRef | ArrayTypeRef | UnionTypeRef;
export type JsonDefault = string | number | boolean | null | JsonDefault[] | { readonly [key: string]: JsonDefault };

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
export type OmitIfExpression = { kind: "literal"; value: number | boolean } | { kind: "field"; name: string } | { kind: "unary"; operator: "!" | "+" | "-"; operand: OmitIfExpression } | { kind: "binary"; operator: "+" | "-" | "*" | "/" | "%" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "&&" | "||"; left: OmitIfExpression; right: OmitIfExpression };

export interface FieldLayout {
  name: string;
  jsonName: string;
  kind: FieldTypeRef["kind"];
  type?: FieldTypeRef;
  index: number;
  offset: number;
  nullable?: boolean;
  optional?: boolean;
  defaultValue?: JsonDefault;
  decorators?: FieldDecorators;
  hostManaged?: boolean;
}

export interface SchemaLayout<T extends object = Record<string, unknown>> {
  name: string;
  root?: "array" | "json-array" | "value";
  fields: FieldLayout[];
  recordSize: number;
  bitmapWords: number;
  nullOffset: number;
  fieldOffset: number;
  lazyOffset?: number;
  nativeStringifyCompatible: boolean;
  features?: unknown;
  abi?: {
    index: number;
    parse: string;
    parseTrusted: string;
    parseInto: string;
    parseIntoTrusted: string;
    serialize: string;
    materialize?: string;
  };
  View: new (runtime: RawNodeBinding, document: number, root: number, asciiSource?: string | null) => T & JsonDocumentView;
  Class?: abstract new (...arguments_: never[]) => T;
}

export interface JsonDocumentView {
  readonly __document: number;
  dispose(): void;
}

export interface RawNodeBindingOptions {
  control?: number;
  scratch?: number;
  scratchCapacity?: number;
  heapReserve?: number;
  maximumPages?: number;
  /** `view` is fastest; `enumerable` makes Object.keys/spread expose fields. */
  objectShape?: "view" | "enumerable";
}

export class RawNodeBinding {
  constructor(wasm: Uint8Array | ArrayBuffer | WebAssembly.Module, options?: RawNodeBindingOptions);
  readonly memory: WebAssembly.Memory;
  readonly u8: Uint8Array;
  readonly scratch: number;
  readonly scratchCapacity: number;
  readonly heapBase: number;
  /**
   * Parse resident Wasm bytes into a non-overlapping caller-owned document
   * buffer. `trusted` means the caller has already validated canonical JSON
   * and UTF-8. Both spans must remain alive, and the caller must keep the
   * output region reserved from json-ty's allocator, while the document is
   * used.
   */
  parseInto(schema: SchemaLayout, source: number, length: number, output: number, capacity: number, options?: { trusted?: boolean }): number;
  parse<T extends object>(schema: SchemaLayout<T>, input: string | Uint8Array): T & JsonDocumentView;
  stringify<T extends object>(schema: SchemaLayout<T>, value: T): string;
  stringifyWasm<T extends object>(schema: SchemaLayout<T>, value: T): string;
  stringifyJS<T extends object>(schema: SchemaLayout<T>, value: T): string;
  /** Builds the complete graph eagerly unless `eager: false` explicitly selects retained spans. */
  parseDynamic(input: string | Uint8Array, options?: { plain?: false; eager?: boolean; validate?: true }): DynamicValueView;
  parseDynamic(input: string | Uint8Array, options: { plain: true }): unknown;
  stringifyDynamic(value: DynamicValueView | unknown): string | undefined;
  echo(input: string | Uint8Array): string;
  release(pointer: number): void;
}

export class JsonArrayView<T = unknown> implements Iterable<T> {
  readonly length: number;
  at(index: number): T | undefined;
  set(index: number, value: T): this;
  values(): IterableIterator<T>;
  [Symbol.iterator](): IterableIterator<T>;
  toArray(): T[];
  dispose(): void;
}

export class DynamicValueView {
  readonly type: "null" | "boolean" | "number" | "string" | "array" | "object" | "invalid";
  readonly value: unknown;
  toJS(): unknown;
  stringify(): string;
  dispose(): void;
}
export class DynamicArrayView extends DynamicValueView implements Iterable<DynamicValueView> {
  readonly length: number;
  at(index: number): DynamicValueView | undefined;
  values(): IterableIterator<DynamicValueView>;
  [Symbol.iterator](): IterableIterator<DynamicValueView>;
  toArray(): unknown[];
}
export class DynamicObjectView extends DynamicValueView {
  readonly size: number;
  get(key: string): DynamicValueView | undefined;
  has(key: string): boolean;
  keys(): IterableIterator<string>;
  entries(): IterableIterator<[string, DynamicValueView]>;
  toObject(): Record<string, unknown>;
}

export function createObjectView<T extends object>(schema: Omit<SchemaLayout<T>, "View">, classPrototype?: object): SchemaLayout<T>["View"];
export function bindSchemaClass<T extends object>(schema: SchemaLayout<T>, constructor: abstract new (...arguments_: never[]) => T): SchemaLayout<T>;
export function createSchemaRegistry(layouts: Array<Omit<SchemaLayout, "View">>, options?: { views?: boolean }): Map<string, SchemaLayout>;
export function instantiateRawNodeBinding(wasm: Uint8Array | ArrayBuffer | WebAssembly.Module, options?: RawNodeBindingOptions): RawNodeBinding;

export class GeneratedViewBase {
  constructor(schema: SchemaLayout, runtime: RawNodeBinding, document: number, root: number, asciiSource?: string | null, state?: object, ownsDocument?: boolean);
}
export function generatedViewDocument(view: object): number;
export function disposeGeneratedView(view: object): void;
export function readGeneratedComposite(view: object, schema: SchemaLayout, field: FieldLayout, cache: symbol): unknown;
export function writeGeneratedField(view: object, schema: SchemaLayout, field: FieldLayout, value: unknown): void;
export function syncGeneratedEnumerable(view: object, field: FieldLayout, present: boolean): void;
export function invalidateGeneratedView(view: object): void;
export function materializeGeneratedField(view: object, schema: SchemaLayout, field: FieldLayout): void;
export function hasViewOverlay(view: object, fieldName: string): boolean;
export function readViewOverlay(view: object, fieldName: string): unknown;
export function writeViewOverlay(view: object, fieldName: string, value: unknown): void;

export const RAW_RUNTIME: unique symbol;
export const RAW_DOCUMENT: unique symbol;
export const RAW_ROOT: unique symbol;
export const RAW_SCHEMA: unique symbol;
export const RAW_ASCII_SOURCE: unique symbol;
export const RAW_OVERLAY: unique symbol;
export const RAW_STATE: unique symbol;
export const RAW_SERIALIZED: unique symbol;
export function activeDocument(view: object, operation: string): number;
export function decodeStringRef(runtime: RawNodeBinding, document: number, pointer: number, asciiSource: string | null): string;

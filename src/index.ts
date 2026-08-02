/** Public TypeScript surface. Optimized calls are rewritten by json-tyc. */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
const rawJsonBrand = Symbol.for("json-ty.raw");
const customCodecBrand = Symbol.for("json-ty.custom-codec");

function dynamicPlain(value: unknown): unknown {
  if (value instanceof FallbackValue) return value.toJS();
  if (value !== null && typeof value === "object" && typeof (value as { toJS?: unknown }).toJS === "function" && "type" in value) {
    return dynamicPlain((value as unknown as { toJS(): unknown }).toJS());
  }
  if (value instanceof JSON.Box) return dynamicPlain(value.value);
  if (value instanceof JSON.Raw) return globalThis.JSON.parse(value.value);
  const custom = value != null && (typeof value === "object" || typeof value === "function")
    ? (value as Record<PropertyKey, unknown>)[customCodecBrand] as { serializer?: string } | undefined
    : undefined;
  if (custom?.serializer) {
    const method = (value as Record<string, unknown>)[custom.serializer];
    if (typeof method !== "function") throw new TypeError(`Custom serializer ${custom.serializer} is unavailable`);
    const encoded = method.call(value, value);
    if (typeof encoded !== "string") throw new TypeError(`Custom serializer ${custom.serializer} must return JSON text`);
    return globalThis.JSON.parse(encoded);
  }
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [String(key), dynamicPlain(item)]));
  if (value instanceof Set) return [...value].map(dynamicPlain);
  if (value instanceof ArrayBuffer) return [...new Uint8Array(value)];
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return Array.from(value as unknown as ArrayLike<number | bigint>, (item) => typeof item === "bigint" ? item.toString() : item);
  if (Array.isArray(value)) return value.map(dynamicPlain);
  return value;
}

class FallbackValue {
  constructor(public _value: unknown = null) {}
  static from<T>(value: T): FallbackValue { return fallbackDynamic(value); }
  static empty(): FallbackValue { return new FallbackValue(null); }
  get type(): "null" | "boolean" | "number" | "string" | "array" | "object" | "invalid" {
    return this._value === null ? "null" : Array.isArray(this._value) ? "array" : typeof this._value === "object" ? "object" : ["boolean", "number", "string"].includes(typeof this._value) ? typeof this._value as "boolean" | "number" | "string" : "invalid";
  }
  get value(): unknown { return this.type === "array" || this.type === "object" ? this : this._value; }
  get<T>(): T {
    if (Array.isArray(this._value)) return new FallbackArr(this._value) as T;
    if (this._value !== null && typeof this._value === "object") return new FallbackObj(this._value as Record<string, unknown>) as T;
    return this._value as T;
  }
  set<T>(value: T): this { this._value = dynamicPlain(value); return this; }
  as<T>(): T { return this as unknown as T; }
  asBox<T extends JsonPrimitive>(): JSON.Box<T> | null { return this._value === null ? null : new JSON.Box(this._value as T); }
  getType<T>(value: T): string {
    if (value instanceof JSON.Box) return this.getType(value.value);
    if (value instanceof JSON.Raw) return JSON.Types.Raw;
    if (value instanceof Map) return JSON.Types.Map;
    if (value instanceof ArrayBuffer) return JSON.Types.ArrayBuffer;
    if (ArrayBuffer.isView(value)) return JSON.Types.TypedArray;
    if (Array.isArray(value) || value instanceof FallbackArr) return JSON.Types.Array;
    if (value instanceof FallbackObj) return JSON.Types.Object;
    if (value === null || value === undefined) return JSON.Types.Null;
    if (typeof value === "boolean") return JSON.Types.Bool;
    if (typeof value === "string") return JSON.Types.String;
    if (typeof value === "number" || typeof value === "bigint") return JSON.Types.Number;
    return typeof value === "object" ? JSON.Types.Struct : JSON.Types.Null;
  }
  toJS(): unknown { return this._value; }
  stringify(): string { return globalThis.JSON.stringify(dynamicPlain(this._value)); }
  toString(): string { return this.stringify(); }
  dispose(): void {}
}

class FallbackArr extends FallbackValue implements Iterable<FallbackValue> {
  constructor(value: unknown[] = []) { super(value); }
  static from<T>(value: T): FallbackArr { const plain = dynamicPlain(value); return new FallbackArr(Array.isArray(plain) ? plain : [plain]); }
  private get array(): unknown[] { return this._value as unknown[]; }
  get length(): number { return this.array.length; }
  set length(value: number) { this.array.length = value; }
  at(index: number): FallbackValue { const value = this.array.at(index); return value === undefined ? undefined as unknown as FallbackValue : fallbackDynamic(value); }
  getAs<T>(index: number): T { const value = this.at(index); if (!value) throw new RangeError(`Index ${index} is out of bounds`); return value.get<T>(); }
  set<T>(value: T): this;
  set(index: number, value: unknown): this;
  set<T>(indexOrValue: number | T, value?: unknown): this { if (arguments.length === 1) this._value = dynamicPlain(indexOrValue); else this.array[indexOrValue as number] = dynamicPlain(value); return this; }
  push<T>(...values: T[]): number { return this.array.push(...values.map(dynamicPlain)); }
  pop(): FallbackValue | undefined { const value = this.array.pop(); return value === undefined ? undefined : fallbackDynamic(value); }
  shift(): FallbackValue | undefined { const value = this.array.shift(); return value === undefined ? undefined : fallbackDynamic(value); }
  unshift<T>(...values: T[]): number { return this.array.unshift(...values.map(dynamicPlain)); }
  clear(): this { this.array.length = 0; return this; }
  reverse(): this { this.array.reverse(); return this; }
  fill<T>(value: T, start?: number, end?: number): this { this.array.fill(dynamicPlain(value), start, end); return this; }
  copyWithin(target: number, start: number, end?: number): this { this.array.copyWithin(target, start, end); return this; }
  slice(start?: number, end?: number): FallbackArr { return new FallbackArr(this.array.slice(start, end)); }
  splice<T>(start: number, deleteCount: number = this.array.length - start, ...values: T[]): FallbackArr { return new FallbackArr(this.array.splice(start, deleteCount, ...values.map(dynamicPlain))); }
  concat(...values: unknown[]): FallbackArr { return new FallbackArr(this.array.concat(...values.map(dynamicPlain))); }
  indexOf<T>(value: T, fromIndex?: number): number { return this.array.indexOf(dynamicPlain(value), fromIndex); }
  lastIndexOf<T>(value: T, fromIndex?: number): number { return fromIndex === undefined ? this.array.lastIndexOf(dynamicPlain(value)) : this.array.lastIndexOf(dynamicPlain(value), fromIndex); }
  includes<T>(value: T, fromIndex?: number): boolean { return this.array.includes(dynamicPlain(value), fromIndex); }
  forEach(callback: (value: FallbackValue, index: number, array: FallbackArr) => void, thisArgument?: unknown): void { this.array.forEach((value, index) => callback.call(thisArgument, fallbackDynamic(value), index, this)); }
  map(callback: (value: FallbackValue, index: number, array: FallbackArr) => unknown, thisArgument?: unknown): FallbackArr { return new FallbackArr(this.array.map((value, index) => dynamicPlain(callback.call(thisArgument, fallbackDynamic(value), index, this)))); }
  filter(callback: (value: FallbackValue, index: number, array: FallbackArr) => unknown, thisArgument?: unknown): FallbackArr { return new FallbackArr(this.array.filter((value, index) => callback.call(thisArgument, fallbackDynamic(value), index, this))); }
  find(callback: (value: FallbackValue, index: number, array: FallbackArr) => unknown, thisArgument?: unknown): FallbackValue | undefined { const value = this.array.find((item, index) => callback.call(thisArgument, fallbackDynamic(item), index, this)); return value === undefined ? undefined : fallbackDynamic(value); }
  findIndex(callback: (value: FallbackValue, index: number, array: FallbackArr) => unknown, thisArgument?: unknown): number { return this.array.findIndex((value, index) => callback.call(thisArgument, fallbackDynamic(value), index, this)); }
  findLast(callback: (value: FallbackValue, index: number, array: FallbackArr) => unknown, thisArgument?: unknown): FallbackValue | undefined { const index = this.findLastIndex(callback, thisArgument); return index < 0 ? undefined : fallbackDynamic(this.array[index]); }
  findLastIndex(callback: (value: FallbackValue, index: number, array: FallbackArr) => unknown, thisArgument?: unknown): number { for (let index = this.array.length - 1; index >= 0; index--) if (callback.call(thisArgument, fallbackDynamic(this.array[index]), index, this)) return index; return -1; }
  every(callback: (value: FallbackValue, index: number, array: FallbackArr) => unknown, thisArgument?: unknown): boolean { return this.array.every((value, index) => callback.call(thisArgument, fallbackDynamic(value), index, this)); }
  some(callback: (value: FallbackValue, index: number, array: FallbackArr) => unknown, thisArgument?: unknown): boolean { return this.array.some((value, index) => callback.call(thisArgument, fallbackDynamic(value), index, this)); }
  reduce<T>(callback: (accumulator: T, value: FallbackValue, index: number, array: FallbackArr) => T, initialValue: T): T { return this.array.reduce<T>((accumulator, value, index) => callback(accumulator, fallbackDynamic(value), index, this), initialValue); }
  reduceRight<T>(callback: (accumulator: T, value: FallbackValue, index: number, array: FallbackArr) => T, initialValue: T): T { return this.array.reduceRight<T>((accumulator, value, index) => callback(accumulator, fallbackDynamic(value), index, this), initialValue); }
  sort(compare?: (left: FallbackValue, right: FallbackValue) => number): this { this.array.sort(compare ? (left, right) => compare(fallbackDynamic(left), fallbackDynamic(right)) : undefined); return this; }
  join(separator?: string): string { return this.array.map((value) => fallbackDynamic(value).toString()).join(separator); }
  *values(): IterableIterator<FallbackValue> { for (const value of this.array) yield fallbackDynamic(value); }
  [Symbol.iterator](): IterableIterator<FallbackValue> { return this.values(); }
  toArray(): JsonValue[] { return this.array as JsonValue[]; }
}

class FallbackObj extends FallbackValue {
  constructor(value: Record<string, unknown> = {}) { super(value); }
  static from<T>(value: T): FallbackObj { const plain = dynamicPlain(value); return new FallbackObj(plain !== null && typeof plain === "object" && !Array.isArray(plain) ? plain as Record<string, unknown> : {}); }
  private get object(): Record<string, unknown> { return this._value as Record<string, unknown>; }
  get size(): number { return Object.keys(this.object).length; }
  set<T>(value: T): this;
  set<T>(key: string, value: T): this;
  set<T>(keyOrValue: string | T, value?: unknown): this { if (arguments.length === 1) this._value = dynamicPlain(keyOrValue); else Object.defineProperty(this.object, keyOrValue as string, { value: dynamicPlain(value), writable: true, enumerable: true, configurable: true }); return this; }
  get<T>(): T;
  get(key: string): FallbackValue | undefined;
  get<T>(key?: string): T | FallbackValue | undefined {
    if (key === undefined) {
      const prototype = Object.getPrototypeOf(this.object);
      return (prototype === Object.prototype || prototype === null ? this : this._value) as T;
    }
    return Object.hasOwn(this.object, key) ? fallbackDynamic(this.object[key]) : undefined;
  }
  getAs<T>(key: string): T { const value = this.get(key); if (!value) throw new ReferenceError(`Missing JSON object key ${globalThis.JSON.stringify(key)}`); return value.get<T>(); }
  has(key: string): boolean { return Object.hasOwn(this.object, key); }
  delete(key: string): boolean { const existed = Object.hasOwn(this.object, key); if (existed) delete this.object[key]; return existed; }
  clear(): this { for (const key of Object.keys(this.object)) delete this.object[key]; return this; }
  keys(): string[] { return Object.keys(this.object); }
  values(): FallbackValue[] { return Object.keys(this.object).map((key) => fallbackDynamic(this.object[key])); }
  entries(): Array<[string, FallbackValue]> { return Object.keys(this.object).map((key) => [key, fallbackDynamic(this.object[key])]); }
  toObject(): JsonObject { return this.object as JsonObject; }
}

function fallbackDynamic(value: unknown): FallbackValue {
  if (value instanceof FallbackValue) return value;
  if (value instanceof JSON.Box) return new FallbackValue(dynamicPlain(value));
  if (value instanceof JSON.Raw) return fallbackDynamic(globalThis.JSON.parse(value.value));
  if (Array.isArray(value)) return new FallbackArr(value);
  if (value !== null && typeof value === "object" && !(value instanceof Map) && !(value instanceof Set) && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) return new FallbackObj(value as Record<string, unknown>);
  const plain = dynamicPlain(value);
  return Array.isArray(plain) ? new FallbackArr(plain) : plain !== null && typeof plain === "object" ? new FallbackObj(plain as Record<string, unknown>) : new FallbackValue(plain);
}

export namespace JSON {
  /** Public runtime tags for dynamic JSON values. */
  export const Types = Object.freeze({
    Null: "null",
    Bool: "boolean",
    Number: "number",
    String: "string",
    Array: "array",
    Object: "object",
    Raw: "raw",
    Map: "map",
    ArrayBuffer: "array-buffer",
    TypedArray: "typed-array",
    Struct: "object",
    I: "number",
    U: "number",
    F: "number",
    I8: "number",
    I16: "number",
    I32: "number",
    I64: "number",
    U8: "number",
    U16: "number",
    U32: "number",
    U64: "number",
    F32: "number",
    F64: "number",
  });
  /** Transparent type marker for a field parsed on first access. */
  export type Lazy<T> = T;
  export interface Value {
    readonly type: "null" | "boolean" | "number" | "string" | "array" | "object" | "invalid";
    readonly value: unknown;
    toJS(): unknown;
    stringify(): string;
    dispose(): void;
    get<T>(): T;
    set<T>(value: T): this;
    as<T>(): T;
    asBox<T extends JsonPrimitive>(): Box<T> | null;
    getType<T>(value: T): string;
  }
  export const Value = FallbackValue as unknown as { new(value?: unknown): Value; empty(): Value; from<T>(value: T): Value };
  export interface Obj extends Value {
    readonly size: number;
    get<T>(): T;
    get(key: string): Value | undefined;
    has(key: string): boolean;
    keys(): string[];
    entries(): Array<[string, Value]>;
    toObject(): JsonObject;
    set<T>(value: T): this;
    set<T>(key: string, value: T): this;
    getAs<T>(key: string): T;
    delete(key: string): boolean;
    clear(): this;
    values(): Value[];
  }
  export const Obj = FallbackObj as unknown as { new(value?: Record<string, unknown>): Obj; from<T>(value: T): Obj };
  export interface Arr extends Value, Iterable<Value> {
    length: number;
    at(index: number): Value;
    values(): IterableIterator<Value>;
    toArray(): JsonValue[];
    getAs<T>(index: number): T;
    set<T>(value: T): this;
    set(index: number, value: unknown): this;
    push<T>(...values: T[]): number;
    pop(): Value | undefined;
    shift(): Value | undefined;
    unshift<T>(...values: T[]): number;
    clear(): this;
    reverse(): this;
    fill<T>(value: T, start?: number, end?: number): this;
    copyWithin(target: number, start: number, end?: number): this;
    slice(start?: number, end?: number): Arr;
    splice<T = unknown>(start: number, deleteCount?: number, ...values: T[]): Arr;
    concat(...values: unknown[]): Arr;
    indexOf<T>(value: T, fromIndex?: number): number;
    lastIndexOf<T>(value: T, fromIndex?: number): number;
    includes<T>(value: T, fromIndex?: number): boolean;
    forEach(callback: (value: Value, index: number, array: Arr) => void, thisArgument?: unknown): void;
    map(callback: (value: Value, index: number, array: Arr) => unknown, thisArgument?: unknown): Arr;
    filter(callback: (value: Value, index: number, array: Arr) => unknown, thisArgument?: unknown): Arr;
    find(callback: (value: Value, index: number, array: Arr) => unknown, thisArgument?: unknown): Value | undefined;
    findIndex(callback: (value: Value, index: number, array: Arr) => unknown, thisArgument?: unknown): number;
    findLast(callback: (value: Value, index: number, array: Arr) => unknown, thisArgument?: unknown): Value | undefined;
    findLastIndex(callback: (value: Value, index: number, array: Arr) => unknown, thisArgument?: unknown): number;
    every(callback: (value: Value, index: number, array: Arr) => unknown, thisArgument?: unknown): boolean;
    some(callback: (value: Value, index: number, array: Arr) => unknown, thisArgument?: unknown): boolean;
    reduce<T>(callback: (accumulator: T, value: Value, index: number, array: Arr) => T, initialValue: T): T;
    reduceRight<T>(callback: (accumulator: T, value: Value, index: number, array: Arr) => T, initialValue: T): T;
    sort(compare?: (left: Value, right: Value) => number): this;
    join(separator?: string): string;
  }
  export const Arr = FallbackArr as unknown as { new(value?: unknown[]): Arr; from<T>(value: T): Arr };

  /** Opt-in memory-backed array contract returned for `JSON.Array<T>`. */
  export interface Array<T> extends Iterable<T> {
    readonly length: number;
    at(index: number): T | undefined;
    set(index: number, value: T): this;
    values(): IterableIterator<T>;
    toArray(): T[];
    dispose(): void;
  }

  /** Marks already-encoded JSON for schemas that explicitly allow raw spans. */
  export class Raw {
    value: string;
    readonly [rawJsonBrand] = true;
    constructor(value: string) {
      globalThis.JSON.parse(value);
      this.value = value;
    }
    toString(): string {
      return this.value;
    }
    get data(): string {
      return this.value;
    }
    set(value: string): void {
      globalThis.JSON.parse(value);
      this.value = value;
    }
    static from(value: string): Raw {
      return new Raw(value);
    }
  }

  /** Nullable primitive wrapper for dynamic JSON values. */
  export class Box<T extends JsonPrimitive> {
    constructor(public value: T) {}
    set(value: T): this {
      this.value = value;
      return this;
    }
    toString(): string {
      return globalThis.JSON.stringify(this.value);
    }
    static from<T extends JsonPrimitive>(value: T): Box<T> {
      return new Box(value);
    }
    static fromValue<T extends JsonPrimitive>(value: Value): Box<T> | null {
      return value.type === "null" ? null : new Box(value.value as T);
    }
  }

  export function from<T extends object>(constructor: new () => T, value: Partial<T>): T {
    return Object.assign(new constructor(), value);
  }

  /**
   * Optional erased schema marker. Interfaces and named object aliases used by
   * typed JSON calls are discovered automatically; use this to pre-generate an
   * otherwise unreachable schema. json-tyc removes the call from emitted code.
   */
  export function schema<T>(): void {}

  /** Native-correct fallback when a call is not transformed by json-tyc. */
  export function parse<T>(data: string | Uint8Array, out?: T): T {
    const source = typeof data === "string" ? data : new TextDecoder().decode(data);
    const parsed = globalThis.JSON.parse(source);
    if (out instanceof FallbackValue) { out._value = dynamicPlain(parsed); return out; }
    return parsed as T;
  }

  /** Native-correct fallback when a call is not transformed by json-tyc. */
  export function stringify<T>(data: T): string {
    const result = globalThis.JSON.stringify(dynamicPlain(data));
    if (result === undefined) throw new TypeError("Value is not JSON serializable");
    return result;
  }

  /** Release a generated memory-backed view. Plain values are a no-op. */
  export function dispose(value: unknown): void {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
    const method = (value as { dispose?: unknown }).dispose;
    if (typeof method === "function") method.call(value);
  }

  export namespace internal {
    export function parse<T>(data: string | Uint8Array, out?: T): T { return JSON.parse<T>(data, out); }
    export function stringify<T>(data: T): string { return JSON.stringify(data); }
  }
}

export type ClassDecoratorTarget<T = object> = abstract new (...arguments_: never[]) => T;
export type OmitPredicate<T> = (self: T) => boolean;
export type LazyMode = "none" | "auto" | "all";
export interface JsonOptions {
  lazy?: LazyMode;
}
export type LazyClassOptions = { mode: LazyMode } | { none: true } | { auto: true } | { all: true };

export function json<T extends Function>(target: T): T;
export function json(): <T extends Function>(target: T) => T;
export function json(_options: JsonOptions): <T extends Function>(target: T) => T;
export function json<T extends Function>(targetOrOptions?: T | JsonOptions): T | (<U extends Function>(value: U) => U) {
  return typeof targetOrOptions === "function" ? targetOrOptions : (value) => value;
}

export const serializable = json;

function propertyMarker(): void {}

export function alias(_name: string): PropertyDecorator {
  return propertyMarker;
}
export function omit(_target: object, _key: string | symbol): void;
export function omit(): PropertyDecorator;
export function omit(..._arguments: unknown[]): void | PropertyDecorator {
  return _arguments.length >= 2 ? undefined : propertyMarker;
}
export function omitnull(_target: object, _key: string | symbol): void;
export function omitnull(): PropertyDecorator;
export function omitnull(..._arguments: unknown[]): void | PropertyDecorator {
  return _arguments.length >= 2 ? undefined : propertyMarker;
}
export function optional(_target: object, _key: string | symbol): void;
export function optional(): PropertyDecorator;
export function optional(..._arguments: unknown[]): void | PropertyDecorator {
  return _arguments.length >= 2 ? undefined : propertyMarker;
}
export function lazy(_target: object, _key: string | symbol): void;
export function lazy(): PropertyDecorator;
export function lazy(_mode: LazyMode | LazyClassOptions): ClassDecorator;
export function lazy(..._arguments: unknown[]): void | PropertyDecorator | ClassDecorator {
  return _arguments.length >= 2 ? undefined : propertyMarker;
}
export function eager(_target: object, _key: string | symbol): void;
export function eager(): PropertyDecorator;
export function eager(..._arguments: unknown[]): void | PropertyDecorator {
  return _arguments.length >= 2 ? undefined : propertyMarker;
}
export function raw(_target: object, _key: string | symbol): void;
export function raw(): PropertyDecorator;
export function raw(..._arguments: unknown[]): void | PropertyDecorator {
  return _arguments.length >= 2 ? undefined : propertyMarker;
}
export function omitif<T>(_predicate: OmitPredicate<T> | string): PropertyDecorator {
  return propertyMarker;
}
export function codec(_implementation: unknown): PropertyDecorator {
  return propertyMarker;
}

export type JsonShape = "any" | "string" | "number" | "object" | "array" | "boolean" | "null";
export function serializer(_shape: JsonShape = "any"): MethodDecorator {
  return propertyMarker;
}
export function deserializer(_shape: JsonShape = "any"): MethodDecorator {
  return propertyMarker;
}

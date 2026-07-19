export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export namespace JSON {
  /** Transparent marker for a field parsed on first access. */
  type Lazy<T> = T;
  interface Value {
    readonly type: "null" | "boolean" | "number" | "string" | "array" | "object" | "invalid";
    readonly value: unknown;
    toJS(): unknown;
    stringify(): string;
    dispose(): void;
  }
  interface Obj extends Value {
    readonly size: number;
    get(key: string): Value | undefined;
    has(key: string): boolean;
    keys(): IterableIterator<string>;
    entries(): IterableIterator<[string, Value]>;
    toObject(): JsonObject;
  }
  interface Arr extends Value, Iterable<Value> {
    readonly length: number;
    at(index: number): Value | undefined;
    values(): IterableIterator<Value>;
    toArray(): JsonValue[];
  }
  interface Array<T> extends Iterable<T> {
    readonly length: number;
    at(index: number): T | undefined;
    set(index: number, value: T): this;
    values(): IterableIterator<T>;
    toArray(): T[];
    dispose(): void;
  }
  class Raw {
    readonly value: string;
    constructor(value: string);
    toString(): string;
  }
  function from<T extends object>(constructor: new () => T, value: Partial<T>): T;
  /** Erased schema marker for interfaces and type aliases. */
  function schema<T>(): void;
  function parse<T>(data: string | Uint8Array): T;
  function stringify<T>(data: T): string | undefined;
  /** Release a generated memory-backed view. Plain values are a no-op. */
  function dispose(value: unknown): void;
}

export type OmitPredicate<T> = (self: T) => boolean;
export type LazyMode = "none" | "auto" | "all";
export interface JsonOptions {
  lazy?: LazyMode;
}
export type LazyClassOptions = { mode: LazyMode } | { none: true } | { auto: true } | { all: true };

export function json<T extends Function>(target: T): T;
export function json(): <T extends Function>(target: T) => T;
export function json(options: JsonOptions): <T extends Function>(target: T) => T;
export const serializable: typeof json;
export function alias(name: string): PropertyDecorator;
export function omit(target: object, key: string | symbol): void;
export function omit(): PropertyDecorator;
export function omitnull(target: object, key: string | symbol): void;
export function omitnull(): PropertyDecorator;
export function optional(target: object, key: string | symbol): void;
export function optional(): PropertyDecorator;
export function lazy(target: object, key: string | symbol): void;
export function lazy(): PropertyDecorator;
export function lazy(mode: LazyMode | LazyClassOptions): ClassDecorator;
export function eager(target: object, key: string | symbol): void;
export function eager(): PropertyDecorator;
export function raw(target: object, key: string | symbol): void;
export function raw(): PropertyDecorator;
export function omitif<T>(predicate: OmitPredicate<T> | string): PropertyDecorator;
export function codec(implementation: unknown): PropertyDecorator;

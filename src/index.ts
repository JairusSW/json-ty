/** Public TypeScript surface. Optimized calls are rewritten by json-tyc. */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
const rawJsonBrand = Symbol.for("json-ty.raw");

export namespace JSON {
  /** Transparent type marker for a field parsed on first access. */
  export type Lazy<T> = T;
  export interface Value {
    readonly type: "null" | "boolean" | "number" | "string" | "array" | "object" | "invalid";
    readonly value: unknown;
    toJS(): unknown;
    stringify(): string;
    dispose(): void;
  }
  export interface Obj extends Value {
    readonly size: number;
    get(key: string): Value | undefined;
    has(key: string): boolean;
    keys(): IterableIterator<string>;
    entries(): IterableIterator<[string, Value]>;
    toObject(): JsonObject;
  }
  export interface Arr extends Value, Iterable<Value> {
    readonly length: number;
    at(index: number): Value | undefined;
    values(): IterableIterator<Value>;
    toArray(): JsonValue[];
  }

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
    readonly value: string;
    readonly [rawJsonBrand] = true;
    constructor(value: string) {
      globalThis.JSON.parse(value);
      this.value = value;
    }
    toString(): string {
      return this.value;
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
  export function parse<T>(data: string | Uint8Array): T {
    const source = typeof data === "string" ? data : new TextDecoder().decode(data);
    return globalThis.JSON.parse(source) as T;
  }

  /** Native-correct fallback when a call is not transformed by json-tyc. */
  export function stringify<T>(data: T): string | undefined {
    return globalThis.JSON.stringify(data);
  }

  /** Release a generated memory-backed view. Plain values are a no-op. */
  export function dispose(value: unknown): void {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
    const method = (value as { dispose?: unknown }).dispose;
    if (typeof method === "function") method.call(value);
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

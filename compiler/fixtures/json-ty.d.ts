declare module "json-ty" {
  export namespace JSON {
    type Lazy<T> = T;
    interface Value {
      readonly type: string;
      toJS(): unknown;
    }
    interface Obj extends Value {
      get(key: string): Value | undefined;
    }
    interface Arr extends Value, Iterable<Value> {
      at(index: number): Value | undefined;
    }
    interface Array<T> extends Iterable<T> {
      readonly length: number;
      at(index: number): T | undefined;
      set(index: number, value: T): this;
    }
    function parse<T>(value: string): T;
    function stringify<T>(value: T): string;
    function schema<T>(): void;
  }
  export function json(value: Function): void;
  export function json(options: { lazy?: "none" | "auto" | "all" }): ClassDecorator;
  export function alias(name: string): PropertyDecorator;
  export function omit(value: object, key: string | symbol): void;
  export function omitnull(value: object, key: string | symbol): void;
  export function optional(value: object, key: string | symbol): void;
  export function omitif<T>(predicate: ((self: T) => boolean) | string): PropertyDecorator;
  export function lazy(value: object, key: string | symbol): void;
  export function lazy(options: "none" | "auto" | "all" | { none?: true; auto?: true; all?: true; mode?: "none" | "auto" | "all" }): ClassDecorator;
  export function eager(value: object, key: string | symbol): void;
}

declare namespace __AdaptedExports {
  /** Exported memory */
  export const memory: WebAssembly.Memory;
  // Exported runtime interface
  export function __new(size: number, id: number): number;
  export function __pin(ptr: number): number;
  export function __unpin(ptr: number): void;
  export function __collect(): void;
  export const __rtti_base: number;
  /**
   * src/wasm/parser/srcPtr
   * @returns `usize`
   */
  export function srcPtr(): number;
  /**
   * src/wasm/parser/reserve
   * @param n `i32`
   * @returns `usize`
   */
  export function reserve(n: number): number;
  /**
   * src/wasm/parser/resetSchemas
   */
  export function resetSchemas(): void;
  /**
   * src/wasm/parser/registerSchema
   * @param descPtr `usize`
   * @param count `i32`
   * @returns `i32`
   */
  export function registerSchema(descPtr: number, count: number): number;
  /**
   * src/wasm/parser/parse
   * @param sid `i32`
   * @param len `i32`
   * @returns `usize`
   */
  export function parse(sid: number, len: number): number;
  /**
   * src/wasm/parser/parseArrayOf
   * @param elemSid `i32`
   * @param len `i32`
   * @returns `usize`
   */
  export function parseArrayOf(elemSid: number, len: number): number;
  /**
   * src/wasm/parser/parsePrimArray
   * @param len `i32`
   * @returns `usize`
   */
  export function parsePrimArray(len: number): number;
  /**
   * src/wasm/parser/enterObject
   * @param sid `i32`
   * @param off `i32`
   * @param len `i32`
   * @returns `usize`
   */
  export function enterObject(sid: number, off: number, len: number): number;
}
/** Instantiates the compiled WebAssembly module with the given imports. */
export declare function instantiate(module: WebAssembly.Module, imports: {
  env: unknown,
}): Promise<typeof __AdaptedExports>;

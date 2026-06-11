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
   * experiments/eager-parse/assembly/eager/srcPtr
   * @returns `usize`
   */
  export function srcPtr(): number;
  /**
   * experiments/eager-parse/assembly/eager/registerSchema
   * @param descPtr `usize`
   * @param count `i32`
   * @returns `i32`
   */
  export function registerSchema(descPtr: number, count: number): number;
  /**
   * experiments/eager-parse/assembly/eager/parseEagerArray
   * @param elemSid `i32`
   * @param len `i32`
   * @returns `usize`
   */
  export function parseEagerArray(elemSid: number, len: number): number;
  /**
   * experiments/eager-parse/assembly/eager/parseEagerObject
   * @param sid `i32`
   * @param len `i32`
   * @returns `usize`
   */
  export function parseEagerObject(sid: number, len: number): number;
}
/** Instantiates the compiled WebAssembly module with the given imports. */
export declare function instantiate(module: WebAssembly.Module, imports: {
  env: unknown,
}): Promise<typeof __AdaptedExports>;

export * from "./index.js";
import { RawBinding, RawBindingOptions, RawWasmSource } from "./index.js";

export class RawBrowserBinding extends RawBinding {}
export function instantiateRawBrowserBinding(source: RawWasmSource | PromiseLike<RawWasmSource>, options?: RawBindingOptions): Promise<RawBrowserBinding>;

export * from "./index.js";
import { RawNodeBinding, RawNodeBindingOptions } from "./index.js";

export class RawBrowserBinding extends RawNodeBinding {}
export function instantiateRawBrowserBinding(source: Uint8Array | ArrayBuffer | WebAssembly.Module | Response | URL | string, options?: RawNodeBindingOptions): Promise<RawBrowserBinding>;

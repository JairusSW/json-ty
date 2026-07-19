import { RawNodeBinding } from "./node-binding.js";

export * from "./node-binding.js";

/** Browser spelling of the shared raw binding. It uses TextEncoder.encodeInto. */
export class RawBrowserBinding extends RawNodeBinding {}

/** Instantiate from bytes, a compiled module, a Response, or a fetchable URL. */
export async function instantiateRawBrowserBinding(source, options) {
  if (source instanceof WebAssembly.Module) return new RawBrowserBinding(source, options);
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    return new RawBrowserBinding(source, options);
  }
  const response = source instanceof Response ? source : await fetch(source);
  if (!response.ok) throw new Error(`Unable to load json-ty Wasm: HTTP ${response.status}`);
  return new RawBrowserBinding(await response.arrayBuffer(), options);
}

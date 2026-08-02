import { RawNodeBinding } from "./node-binding.js";
import { loadRawWasm } from "./portable-binding.js";
import { createTextHostByteCodec } from "./host-byte-bridge.js";

export * from "./node-binding.js";
export * from "./portable-binding.js";

/** Browser spelling of the shared raw binding. It uses TextEncoder.encodeInto. */
export class RawBrowserBinding extends RawNodeBinding {
  constructor(wasm, options) {
    super(wasm, options, createTextHostByteCodec());
  }
}

/** Instantiate from bytes, a compiled module, a Response, or a fetchable URL. */
export async function instantiateRawBrowserBinding(source, options) {
  return new RawBrowserBinding(await loadRawWasm(source), options);
}

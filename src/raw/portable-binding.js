import { RawNodeBinding } from "./node-binding.js";

export { RawNodeBinding as RawBinding };

function isWebAssemblyModule(value) {
  return typeof WebAssembly.Module === "function" && value instanceof WebAssembly.Module;
}

function isBufferSource(value) {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function asBytes(value) {
  if (value instanceof ArrayBuffer || value instanceof Uint8Array) return value;
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function isResponse(value) {
  return typeof Response === "function" && value instanceof Response;
}

function isRequest(value) {
  return typeof Request === "function" && value instanceof Request;
}

function isFileUrl(value) {
  return typeof URL === "function" && value instanceof URL && value.protocol === "file:";
}

async function compileResponse(response) {
  if (!response.ok) {
    throw new Error(`Unable to load json-ty Wasm: HTTP ${response.status}`);
  }
  if (typeof WebAssembly.compileStreaming === "function" && typeof response.clone === "function") {
    try {
      return await WebAssembly.compileStreaming(response.clone());
    } catch {
      // Servers frequently omit application/wasm. Array-buffer compilation is
      // the portable fallback and preserves the useful compile error.
    }
  }
  return new WebAssembly.Module(await response.arrayBuffer());
}

function hasLocalFileReader() {
  return Boolean(globalThis.Bun?.file || globalThis.Deno?.readFile || globalThis.process?.versions?.node);
}

async function readLocalFile(path) {
  if (globalThis.Bun?.file) {
    return new Uint8Array(await globalThis.Bun.file(path).arrayBuffer());
  }
  if (globalThis.Deno?.readFile) {
    return globalThis.Deno.readFile(path);
  }
  if (globalThis.process?.versions?.node) {
    const nodeFs = ["node", "fs/promises"].join(":");
    const { readFile } = await import(nodeFs);
    return readFile(path);
  }
  throw new TypeError("file: Wasm URLs are not available in this runtime; pass bytes or a fetchable URL");
}

export async function loadRawWasm(source) {
  source = await source;
  if (isWebAssemblyModule(source)) return source;
  if (isBufferSource(source)) return asBytes(source);
  if (isResponse(source)) return compileResponse(source);
  if (isFileUrl(source)) return readLocalFile(source);
  if (typeof source === "string" && hasLocalFileReader()) {
    if (source.startsWith("file:")) return readLocalFile(new URL(source));
    if (!/^(?:https?|data|blob):/i.test(source)) return readLocalFile(source);
  }
  if (isRequest(source) || typeof source === "string" || (typeof URL === "function" && source instanceof URL)) {
    if (typeof fetch !== "function") {
      throw new TypeError("This runtime has no fetch implementation; pass Wasm bytes or a WebAssembly.Module");
    }
    return compileResponse(await fetch(source));
  }
  if (source !== null && typeof source?.arrayBuffer === "function") {
    return new Uint8Array(await source.arrayBuffer());
  }
  throw new TypeError("Expected Wasm bytes, a WebAssembly.Module, Response, URL, Request, or blob-like source");
}

/**
 * Instantiate json-ty through APIs shared by browsers, workers, Deno, Bun,
 * and Node. Local file URLs use the host's native file API when available.
 */
export async function instantiateRawBinding(source, options) {
  return new RawNodeBinding(await loadRawWasm(source), options);
}

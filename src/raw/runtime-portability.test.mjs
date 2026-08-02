import { RawBinding, createSchemaRegistry, instantiateRawBinding } from "./index.js";

const wasmUrl = new URL("../../build/raw/runtime.wasm", import.meta.url);
const layoutsUrl = new URL("../../build/raw/schema-layouts.json", import.meta.url);
const options = { scratchCapacity: 1 << 20, heapReserve: 1 << 20 };
const expected = "portable café 世界 😀";
const bytes = await readBytes(wasmUrl);
const schemas = createSchemaRegistry(JSON.parse(new TextDecoder().decode(await readBytes(layoutsUrl))));

const fromFile = await instantiateRawBinding(wasmUrl, options);
if (!(fromFile instanceof RawBinding)) throw new Error("RawBinding alias failed");
if (fromFile.echo(expected) !== expected) throw new Error("file URL binding failed");
const metric = fromFile.parse(schemas.get("Metric"), '{"id":7,"value":2.5,"label":"portable","ok":true}');
if (metric.id !== 7 || metric.label !== "portable") {
  throw new Error("portable schema binding failed");
}
metric.dispose();

const fromPath = await instantiateRawBinding("build/raw/runtime.wasm", options);
if (fromPath.echo(expected) !== expected) throw new Error("local path binding failed");

const fromBytes = await instantiateRawBinding(Promise.resolve(bytes), options);
if (fromBytes.echo(expected) !== expected) throw new Error("byte binding failed");

const fromModule = await instantiateRawBinding(new WebAssembly.Module(bytes), options);
if (fromModule.echo(expected) !== expected) throw new Error("compiled module binding failed");

if (typeof Blob === "function") {
  const fromBlob = await instantiateRawBinding(new Blob([bytes]), options);
  if (fromBlob.echo(expected) !== expected) throw new Error("blob binding failed");
}

const response = typeof Response === "function" ? new Response(bytes, { headers: { "content-type": "application/wasm" } }) : null;
if (response !== null) {
  const fromResponse = await instantiateRawBinding(response, options);
  if (fromResponse.echo(expected) !== expected) throw new Error("Response binding failed");
}

console.log("portable raw binding: all tests passed");

async function readBytes(url) {
  if (globalThis.Bun?.file) return new Uint8Array(await globalThis.Bun.file(url).arrayBuffer());
  if (globalThis.Deno?.readFile) return globalThis.Deno.readFile(url);
  const nodeFs = ["node", "fs/promises"].join(":");
  return new Uint8Array(await (await import(nodeFs)).readFile(url));
}

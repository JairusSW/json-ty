import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wasm = new Uint8Array(readFileSync("build/raw/runtime.wasm"));
const layouts = JSON.parse(readFileSync("build/raw/schema-layouts.json", "utf8"));
const BufferClass = globalThis.Buffer;

try {
  delete globalThis.Buffer;
  const { RawNodeBinding, createSchemaRegistry } = await import("./node-binding.js");
  const binding = new RawNodeBinding(wasm, {
    scratchCapacity: 1 << 20,
    heapReserve: 1 << 20,
  });

  assert.equal(binding.buffer, null, "the default binding must select the text codec without Buffer");
  assert.equal(binding.echo("bufferless café 世界 😀"), "bufferless café 世界 😀");

  const schemas = createSchemaRegistry(layouts);
  const metric = binding.parse(schemas.get("Metric"), '{"id":7,"label":"café 😀","ok":true}');
  assert.equal(metric.id, 7);
  assert.equal(metric.label, "café 😀");
  assert.equal(binding.stringify(schemas.get("Metric"), metric), '{"id":7,"label":"café 😀","ok":true}');
  metric.dispose();
} finally {
  globalThis.Buffer = BufferClass;
}

console.log("raw Buffer-less binding: all tests passed");

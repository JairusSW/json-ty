import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wasm = new Uint8Array(readFileSync("build/raw/runtime.wasm"));
const layouts = JSON.parse(readFileSync("build/raw/schema-layouts.json", "utf8"));
const { RawBrowserBinding, createSchemaRegistry } = await import("./browser-binding.js");

const binding = new RawBrowserBinding(wasm, { scratchCapacity: 1 << 20, heapReserve: 1 << 20 });
assert.equal(binding.buffer, null, "browser adapter must use its TextEncoder byte codec even under Node");
assert.equal(binding.echo("browser café 😀"), "browser café 😀");
const schemas = createSchemaRegistry(layouts);
const metric = binding.parse(schemas.get("Metric"), '{"id":7,"label":"web","ok":true}');
assert.equal(metric.id, 7);
assert.equal(metric.label, "web");
assert.equal(binding.stringify(schemas.get("Metric"), metric), '{"id":7,"label":"web","ok":true}');
metric.dispose();

console.log("raw browser byte binding: all tests passed");

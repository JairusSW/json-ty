import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RawNodeBinding, createSchemaRegistry } from "./node-binding.js";

const bytes = readFileSync("build/raw/runtime.wasm");
// Includes dedicated eager/lazy fixture schemas in addition to the production
// kernels; keep a tight ceiling so materializer generation cannot run away.
// The allocation-free escaped-span canonicalizer adds the full native
// JSON.stringify escape/surrogate behavior to every typed and dynamic string.
// The verified-candidate protocol also includes one shared byte comparator so
// source copying is enabled only after an exact first serialization.
assert.ok(bytes.byteLength <= 116_000, `raw artifact unexpectedly grew to ${bytes.byteLength} bytes`);
const module = new WebAssembly.Module(bytes);
assert.deepEqual(
  WebAssembly.Module.imports(module).map(({ module: namespace, name, kind }) => ({ module: namespace, name, kind })),
  [
    { module: "env", name: "parseNumberSlow", kind: "function" },
    { module: "env", name: "memory", kind: "memory" },
  ],
);

const exports = new Set(WebAssembly.Module.exports(module).map(({ name }) => name));
for (const name of ["parseMetric", "parseMetricTrusted", "serializeMetric", "parsePlayer", "parsePlayerTrusted", "serializePlayer", "parseDynamic", "parseDynamicTrusted", "serializeDynamic", "materializeLazyRecordField"]) {
  assert.ok(exports.has(name), `missing ABI export ${name}`);
}

const layouts = createSchemaRegistry(JSON.parse(readFileSync("build/raw/schema-layouts.json", "utf8")));
const runtime = new RawNodeBinding(module, { scratchCapacity: 1 << 20, heapReserve: 1 << 20 });
const Metric = layouts.get("Metric");

let typedParseCalls = 0;
const parseMetric = runtime.exports.parseMetric;
runtime._parsers.set("Metric", (...arguments_) => {
  typedParseCalls++;
  return parseMetric(...arguments_);
});
const metric = runtime.parse(Metric, '{"id":1,"value":2.5,"label":"one call","ok":true}');
assert.equal(typedParseCalls, 1, "typed parse must cross into Wasm exactly once");

let typedSerializeCalls = 0;
const serializeMetric = runtime.exports.serializeMetric;
runtime._serializers.set("Metric", (...arguments_) => {
  typedSerializeCalls++;
  return serializeMetric(...arguments_);
});
assert.equal(runtime.stringify(Metric, metric), '{"id":1,"value":2.5,"label":"one call","ok":true}');
assert.equal(typedSerializeCalls, 1, "typed stringify must cross into Wasm exactly once");
metric.dispose();

const LazyRecord = layouts.get("LazyRecord");
const lazy = runtime.parse(LazyRecord, '{"id":1,"child":{"id":2,"label":"x"}}');
let materializeCalls = 0;
const materializeLazyRecord = runtime.exports.materializeLazyRecordField;
runtime._materializers.set("LazyRecord", (...arguments_) => {
  materializeCalls++;
  return materializeLazyRecord(...arguments_);
});
assert.equal(lazy.id, 1);
assert.equal(materializeCalls, 0, "eager fields must not cross into the lazy materializer");
assert.equal(lazy.child.id, 2);
assert.equal(lazy.child.id, 2);
assert.equal(materializeCalls, 1, "first lazy access must make exactly one Wasm call and cache the result");
lazy.dispose();

let dynamicParseCalls = 0;
const parseDynamic = runtime._parseDynamic;
const parseDynamicTrusted = runtime._parseDynamicTrusted;
runtime._parseDynamic = (...arguments_) => {
  dynamicParseCalls++;
  return parseDynamic(...arguments_);
};
runtime._parseDynamicTrusted = (...arguments_) => {
  dynamicParseCalls++;
  return parseDynamicTrusted(...arguments_);
};
const dynamic = runtime.parseDynamic('{"items":[1,true,"x"]}');
assert.equal(dynamicParseCalls, 1, "dynamic parse must cross into Wasm exactly once");

let dynamicSerializeCalls = 0;
const serializeDynamic = runtime._serializeDynamic;
runtime._serializeDynamic = (...arguments_) => {
  dynamicSerializeCalls++;
  return serializeDynamic(...arguments_);
};
assert.equal(runtime.stringifyDynamic(dynamic), '{"items":[1,true,"x"]}');
assert.equal(dynamicSerializeCalls, 1, "dynamic stringify must cross into Wasm exactly once");
dynamic.dispose();

console.log("raw Wasm ABI/import/call-boundary contract: all tests passed");

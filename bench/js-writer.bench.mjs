import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { RawNodeBinding, createSchemaRegistry } from "../src/raw/node-binding.js";

const layouts = JSON.parse(readFileSync("build/raw/schema-layouts.json", "utf8"));
const schemas = createSchemaRegistry(layouts);
const runtime = new RawNodeBinding(readFileSync("build/raw/runtime.wasm"), {
  scratchCapacity: 1 << 20,
  heapReserve: 64 << 10,
});
const schema = schemas.get("Defaults");
const value = { count: 7, active: true, label: 'a"x', note: null, secret: "never emit" };
const expected = '{"count":7,"active":true,"display label":"a\\\"x"}';
const duration = Math.max(100, Number(process.env.JSON_TY_BENCH_MS ?? 500));
let sink = 0;

function schemaWalk() {
  let output = "{";
  let wrote = false;
  for (const field of schema.fields) {
    if (field.decorators?.omit) continue;
    const fieldValue = value[field.name];
    if (fieldValue === undefined || (fieldValue === null && field.decorators?.omitNull)) continue;
    const encoded = JSON.stringify(fieldValue);
    if (encoded === undefined) continue;
    if (wrote) output += ",";
    output += `${JSON.stringify(field.jsonName)}:${encoded}`;
    wrote = true;
  }
  return output + "}";
}

const variants = [
  ["projection + JSON.stringify", () => JSON.stringify({ count: value.count, active: value.active, "display label": value.label })],
  ["generic schema walk", schemaWalk],
  ["compiled JS plan", () => runtime.stringifyJS(schema, value)],
  ["plain-object Wasm", () => runtime.stringifyWasm(schema, value)],
];

for (const [name, operation] of variants) assert.equal(operation(), expected, name);

for (const [name, operation] of variants) {
  for (let index = 0; index < 10_000; index++) sink += operation().length;
  let iterations = 1;
  let elapsed = 0;
  while (elapsed < duration) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) sink += operation().length;
    elapsed = performance.now() - start;
    if (elapsed < duration) iterations *= 2;
  }
  console.log(`${name.padEnd(28)} ${Math.round((iterations / elapsed) * 1000).toLocaleString().padStart(12)} ops/s`);
}

if (sink === 0) throw new Error("benchmark output was not consumed");

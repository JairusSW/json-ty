import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RawNodeBinding, createObjectView, createSchemaRegistry } from "./node-binding.js";

const runtime = new RawNodeBinding(readFileSync("build/raw/runtime.wasm"), {
  scratchCapacity: 1 << 20,
  heapReserve: 2 << 20,
});
const metricLayout = JSON.parse(readFileSync("build/raw/schema-layouts.json", "utf8")).find((layout) => layout.name === "Metric");
const Metric = { ...metricLayout, View: createObjectView(metricLayout) };
const schemas = createSchemaRegistry(JSON.parse(readFileSync("build/raw/schema-layouts.json", "utf8")));
const LazyRecord = schemas.get("LazyRecord");

let seed = 0x12345678;
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed;
}

for (let iteration = 0; iteration < 30_000; iteration++) {
  const digits = (random() % 45) + 1;
  let decimal = String((random() % 9) + 1);
  for (let index = 1; index < digits; index++) decimal += String(random() % 10);
  const point = (random() % digits) + 1;
  if (point < digits) decimal = `${decimal.slice(0, point)}.${decimal.slice(point)}`;
  const exponent = (random() % 701) - 350;
  const source = `${random() & 1 ? "-" : ""}${decimal}e${exponent >= 0 ? "+" : ""}${exponent}`;
  const expected = JSON.parse(source);
  const view = runtime.parse(Metric, `{"value":${source}}`);
  assert.ok(Object.is(view.value, expected), `number mismatch for ${source}`);
  view.dispose();
}

const bits = new BigUint64Array(1);
const doubles = new Float64Array(bits.buffer);
for (let iteration = 0; iteration < 30_000; iteration++) {
  bits[0] = (BigInt(random()) << 32n) | BigInt(random());
  const value = doubles[0];
  if (!Number.isFinite(value)) continue;
  const source = JSON.stringify(value);
  const view = runtime.parse(Metric, `{"value":${source}}`);
  assert.ok(Object.is(view.value, value), `f64 round trip mismatch for ${source}`);
  assert.equal(runtime.stringify(Metric, view), `{"value":${source}` + "}");
  view.dispose();
}

const stringAtoms = ["", "ascii", "café", "😀", "line\nfeed", 'quote"slash\\', "\ud800"];
function randomValue(depth = 0) {
  const kind = depth >= 4 ? random() % 5 : random() % 7;
  if (kind === 0) return null;
  if (kind === 1) return Boolean(random() & 1);
  if (kind === 2) return (random() - 0x80000000) / ((random() % 100) + 1);
  if (kind === 3) return stringAtoms[random() % stringAtoms.length];
  if (kind === 4) return random() % 1000;
  if (kind === 5) return Array.from({ length: random() % 5 }, () => randomValue(depth + 1));
  const object = {};
  for (let index = 0; index < random() % 5; index++) object[`k${index}_${random() % 7}`] = randomValue(depth + 1);
  return object;
}

for (let iteration = 0; iteration < 5_000; iteration++) {
  const value = randomValue();
  const source = JSON.stringify(value);
  assert.deepEqual(runtime.parseDynamic(source, { plain: true }), value);
}

for (let iteration = 0; iteration < 2_000; iteration++) {
  const value = {
    id: random() % 10_000,
    count: (random() - 0x80000000) / ((random() % 17) + 1),
    enabled: Boolean(random() & 1),
    name: stringAtoms[random() % stringAtoms.length],
    child: { id: random() % 1000, label: stringAtoms[random() % stringAtoms.length] },
    values: Array.from({ length: random() % 8 }, () => (random() % 10_000) / 7),
    childEager: { id: random() % 1000, label: "eager" },
    nullable: random() & 1 ? null : { id: random() % 1000, label: "nullable" },
  };
  const view = runtime.parse(LazyRecord, JSON.stringify(value));
  if (random() & 1) assert.equal(view.count, value.count);
  if (random() & 1) assert.equal(view.enabled, value.enabled);
  if (random() & 1) assert.equal(view.child.id, value.child.id);
  if (random() & 1) assert.deepEqual(view.values, value.values);
  if ((random() & 7) === 0) {
    value.count = 99;
    view.count = value.count;
  }
  assert.deepEqual(JSON.parse(runtime.stringify(LazyRecord, view)), value);
  view.dispose();
}

console.log("raw differential fuzz: all cases passed");

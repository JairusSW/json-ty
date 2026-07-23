import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { RawNodeBinding, createSchemaRegistry } from "../src/raw/node-binding.js";
import { parityPayloads } from "./parity/payloads.mjs";

const targetMs = Math.max(50, Number(process.env.JSON_TY_LAZY_BENCH_MS ?? 250));
const tierMetadata = JSON.parse(readFileSync("build/parity/kernel-tier.json", "utf8"));

function measure(bytes, operation) {
  let iterations = 1;
  let elapsed = 0;
  while (elapsed < 20) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) operation();
    elapsed = performance.now() - start;
    if (elapsed < 20) iterations *= 2;
  }
  iterations = Math.max(1, Math.ceil((iterations * targetMs) / elapsed));
  const start = performance.now();
  for (let index = 0; index < iterations; index++) operation();
  elapsed = performance.now() - start;
  return { mbps: (bytes * iterations) / (elapsed / 1000) / 1e6, nsPerOp: (elapsed * 1e6) / iterations };
}

const runtime = new RawNodeBinding(readFileSync("build/parity/runtime.wasm"), { scratchCapacity: 8 << 20, heapReserve: 64 << 20 });
const schemas = createSchemaRegistry(JSON.parse(readFileSync("build/parity/schema-layouts.json", "utf8")));
const rows = [];

for (const payload of parityPayloads.filter(({ key }) => key !== "vec3")) {
  const eager = schemas.get(payload.schema);
  const lazy = schemas.get(`${payload.schema}Lazy`);
  const touchNone = () => {};
  const touchOne = (view) => (payload.key === "small" ? view.name : view.addr.city);
  const touchAll = (schema) => (view) => {
    for (const field of schema.fields) {
      const value = view[field.name];
      if (Array.isArray(value)) value.length;
      else if (value && typeof value === "object") Object.values(value).length;
    }
  };
  const cases = [
    ["native-none", null, touchNone],
    ["eager-none", eager, touchNone],
    ["lazy-none", lazy, touchNone],
    ["native-one", null, touchOne],
    ["eager-one", eager, touchOne],
    ["lazy-one", lazy, touchOne],
    ["native-all", null, touchAll(eager)],
    ["eager-all", eager, touchAll(eager)],
    ["lazy-all", lazy, touchAll(lazy)],
  ];
  for (const [mode, schema, touch] of cases) {
    const result = measure(payload.bytes, () => {
      const view = schema === null ? JSON.parse(payload.json) : runtime.parse(schema, payload.json);
      touch(view);
      view.dispose?.();
    });
    rows.push({ payload: payload.key, mode, ...result });
    console.log(`${payload.key.padEnd(7)} ${mode.padEnd(10)} ${Math.round(result.mbps).toLocaleString().padStart(6)} MB/s  ${result.nsPerOp.toFixed(1)} ns/op`);
  }
}

mkdirSync("build/logs", { recursive: true });
writeFileSync("build/logs/lazy.json", JSON.stringify({ generatedAt: new Date().toISOString(), tierMetadata, rows }, null, 2));

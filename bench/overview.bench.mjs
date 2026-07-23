import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { RawNodeBinding, createSchemaRegistry } from "../src/raw/node-binding.js";
import { payloads } from "./overview/payloads.mjs";

const wasm = readFileSync("build/overview/runtime.wasm");
const tierMetadata = JSON.parse(readFileSync("build/overview/kernel-tier.json", "utf8"));
const layouts = JSON.parse(readFileSync("build/overview/schema-layouts.json", "utf8"));
const schemas = createSchemaRegistry(layouts);
const runtime = new RawNodeBinding(wasm, { scratchCapacity: 16 << 20, heapReserve: 64 << 20 });
const targetMs = Math.max(50, Number(process.env.JSON_TY_BENCH_MS ?? 250));
const requestedPayloads = new Set(
  (process.env.JSON_TY_OVERVIEW_FILTER ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const selectedPayloads = requestedPayloads.size === 0
  ? payloads
  : payloads.filter((payload) => requestedPayloads.has(payload.key));
if (selectedPayloads.length === 0) {
  throw new Error(`JSON_TY_OVERVIEW_FILTER selected no payloads: ${[...requestedPayloads].join(",")}`);
}
const missingPayloads = [...requestedPayloads].filter((key) => !selectedPayloads.some((payload) => payload.key === key));
if (missingPayloads.length !== 0) {
  throw new Error(`Unknown overview payloads: ${missingPayloads.join(",")}`);
}
let sink = 0;

const SERIES = {
  serialize: [
    ["native", "Built-in JSON (JS)"],
    ["generated-js", "json-ty (generated JS)"],
    ["plain-wasm", "json-ty (plain via Wasm)"],
    ["retained", "json-ty (retained view)"],
    ["dynamic", "json-ty (JSON.Obj)"],
  ],
  deserialize: [
    ["native", "Built-in JSON (JS)"],
    ["typed-string", "json-ty (resident string)"],
    ["typed-buffer", "json-ty (typed Buffer)"],
    ["dynamic-string", "json-ty (JSON.Obj string)"],
    ["dynamic-buffer", "json-ty (JSON.Obj Buffer)"],
  ],
};

function consume(value) {
  if (typeof value === "string") return value.length;
  if (typeof value === "number") return value | 0;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value ? 1 : 0;
}

function invoke(operation) {
  sink = (sink + consume(operation())) | 0;
}

function measure(payload, kind, series, description, operation) {
  let calibrationIterations = 1;
  let elapsed = 0;
  while (elapsed < 20) {
    const start = performance.now();
    for (let index = 0; index < calibrationIterations; index++) invoke(operation);
    elapsed = performance.now() - start;
    if (elapsed < 20) calibrationIterations *= 2;
  }

  const operations = Math.max(1, Math.ceil((calibrationIterations * targetMs) / elapsed));
  const warmup = Math.max(1, Math.ceil(operations / 10));
  for (let index = 0; index < warmup; index++) invoke(operation);

  const start = performance.now();
  for (let index = 0; index < operations; index++) invoke(operation);
  const measuredMs = performance.now() - start;
  const seconds = measuredMs / 1000;
  const mbps = (payload.bytes * operations) / seconds / 1e6;
  const result = {
    payload: payload.key,
    kind,
    series,
    description,
    elapsed: measuredMs,
    bytes: payload.bytes,
    operations,
    features: ["utf8", "stub-runtime", tierMetadata.kernelTier, "node-buffer"],
    mbps,
    gbps: mbps / 1000,
    opsPerSecond: operations / seconds,
  };
  console.log(`${payload.key.padEnd(8)} ${kind.padEnd(11)} ${description.padEnd(29)} ${Math.round(mbps).toLocaleString().padStart(7)} MB/s`);
  return result;
}

function assertEquivalent(actual, expected, context) {
  const left = JSON.stringify(JSON.parse(actual));
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${context} produced different JSON`);
}

function stringifyDynamicUncached(value) {
  const document = value._document();
  const capacity = runtime.scratchCapacity - 128;
  runtime._serializeDynamic(document, runtime.scratch, capacity);
  if (runtime._result(0) !== 0) throw new RangeError(`Raw dynamic stringify failed with status ${runtime._result(0)}`);
  const output = runtime._result(20);
  const length = runtime._result(24);
  return runtime._decodeUtf8(output, output + length);
}

const results = [];
for (const payload of selectedPayloads) {
  const schema = payload.schema === null ? null : schemas.get(payload.schema);
  const retained = schema ? runtime.parse(schema, payload.buffer) : null;
  const dynamic = runtime.parseDynamic(payload.buffer);

  try {
    assertEquivalent(JSON.stringify(payload.value), payload.value, `${payload.key}: native`);
    assertEquivalent(runtime.stringifyDynamic(dynamic), payload.value, `${payload.key}: dynamic`);
    if (schema) {
      assertEquivalent(runtime.stringifyJS(schema, payload.value), payload.value, `${payload.key}: generated JS`);
      assertEquivalent(runtime.stringifyWasm(schema, payload.value), payload.value, `${payload.key}: plain Wasm`);
      assertEquivalent(runtime.stringify(schema, retained), payload.value, `${payload.key}: retained`);
    }

    for (const [series, description] of SERIES.serialize) {
      let operation = null;
      if (series === "native") operation = () => JSON.stringify(payload.value);
      else if (series === "generated-js" && schema) operation = () => runtime.stringifyJS(schema, payload.value);
      else if (series === "plain-wasm" && schema) operation = () => runtime.stringifyWasm(schema, payload.value);
      else if (series === "retained" && schema) operation = () => runtime._serializeDocument(schema, retained.__document, runtime.scratch);
      else if (series === "dynamic") operation = () => stringifyDynamicUncached(dynamic);
      if (operation) results.push(measure(payload, "serialize", series, description, operation));
    }
    if (schema) {
      results.push(measure(payload, "serialize", "retained-cached", "json-ty (cached view)", () => runtime.stringify(schema, retained)));
    }
    results.push(measure(payload, "serialize", "dynamic-cached", "json-ty (cached JSON.Obj)", () => runtime.stringifyDynamic(dynamic)));

    for (const [series, description] of SERIES.deserialize) {
      let operation;
      if (series === "native") operation = () => JSON.parse(payload.json);
      else if (series === "typed-string" && schema)
        operation = () => {
          const value = runtime.parse(schema, payload.json);
          value.dispose();
          return payload.bytes;
        };
      else if (series === "typed-buffer" && schema)
        operation = () => {
          const value = runtime.parse(schema, payload.buffer);
          value.dispose();
          return payload.bytes;
        };
      else if (series === "dynamic-string")
        operation = () => {
          const value = runtime.parseDynamic(payload.json);
          value.dispose();
          return payload.bytes;
        };
      else if (series === "dynamic-buffer")
        operation = () => {
          const value = runtime.parseDynamic(payload.buffer);
          value.dispose();
          return payload.bytes;
        };
      if (operation) results.push(measure(payload, "deserialize", series, description, operation));
    }
  } finally {
    retained?.dispose();
    dynamic.dispose();
  }
}

mkdirSync("build/logs", { recursive: true });
writeFileSync("build/logs/overview.json", JSON.stringify({ generatedAt: new Date().toISOString(), tierMetadata, targetMs, sink, payloads: selectedPayloads.map(({ key, title, label, bytes }) => ({ key, title, label, bytes })), series: SERIES, results }, null, 2));
console.log(`> build/logs/overview.json (${results.length} measurements, sink=${sink})`);

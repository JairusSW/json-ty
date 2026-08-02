import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { RawNodeBinding, createSchemaRegistry } from "../src/raw/node-binding.js";
import { classicCorpora, classicSeries } from "./classic/manifest.mjs";
import { projections, twitterQueries } from "./classic/projections.mjs";

const MIB = 1 << 20;
const WASM_PAGE = 1 << 16;
const tierMetadata = JSON.parse(readFileSync("build/classic/kernel-tier.json", "utf8"));
const targetMs = Math.max(25, Number(process.env.JSON_TY_BENCH_MS ?? 200));
const maximumBytes = process.env.JSON_TY_CLASSIC_MAX_BYTES === undefined ? Number.POSITIVE_INFINITY : Number(process.env.JSON_TY_CLASSIC_MAX_BYTES);
const inputKind = process.env.JSON_TY_CLASSIC_INPUT ?? "buffer";
const eagerBackend = process.env.JSON_TY_CLASSIC_EAGER_BACKEND ?? "graph";
if (inputKind !== "string" && inputKind !== "buffer") throw new Error("JSON_TY_CLASSIC_INPUT must be string or buffer");
if (eagerBackend !== "graph" && eagerBackend !== "plain" && eagerBackend !== "host") {
  throw new Error("JSON_TY_CLASSIC_EAGER_BACKEND must be graph or plain");
}

function selectedValues(name, defaults) {
  const value = process.env[name];
  return new Set(
    value
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : defaults,
  );
}

const selectedCorpora = selectedValues(
  "JSON_TY_CLASSIC_FILTER",
  classicCorpora.map(({ key }) => key),
);
const selectedVariants = selectedValues("JSON_TY_CLASSIC_VARIANTS", ["native", "eager", "lazy", "obj"]);
const selectedFormats = selectedValues("JSON_TY_CLASSIC_FORMATS", ["pretty", "min"]);
const completeSelection =
  classicCorpora.every(({ key }) => selectedCorpora.has(key)) &&
  ["native", "eager", "lazy", "obj"].every((value) => selectedVariants.has(value)) &&
  ["pretty", "min"].every((value) => selectedFormats.has(value)) &&
  !Number.isFinite(maximumBytes);
const reportPath =
  process.env.JSON_TY_CLASSIC_REPORT ??
  (completeSelection ? "build/logs/classic.json" : "build/logs/classic-partial.json");

function findPayloadDirectory() {
  const candidates = [process.env.JSON_TY_CLASSIC_PAYLOADS, "../json-as/assembly/__benches__/payloads", "./assembly/__benches__/payloads"].filter(Boolean);
  for (const candidate of candidates) {
    const absolute = resolve(candidate);
    if (existsSync(absolute)) return absolute;
  }
  throw new Error("Classic payloads were not found. Keep json-as beside json-ty or set JSON_TY_CLASSIC_PAYLOADS to json-as/assembly/__benches__/payloads.");
}

const payloadDirectory = findPayloadDirectory();
const selected = classicCorpora.filter(({ key }) => selectedCorpora.has(key));
if (selected.length === 0) throw new Error("JSON_TY_CLASSIC_FILTER did not select any known corpus");

const payloadSizes = selected.flatMap((corpus) =>
  Object.entries(corpus.files)
    .filter(([format]) => selectedFormats.has(format))
    .map(([, file]) => statSync(resolve(payloadDirectory, file)).size)
    .filter((bytes) => bytes <= maximumBytes),
);
const largestPayload = Math.max(...payloadSizes, 1);
const alignPage = (value) => Math.ceil(value / WASM_PAGE) * WASM_PAGE;
const scratchCapacity = Math.max(8 * MIB, alignPage(largestPayload + MIB));
// Parsing can grow the wilderness document in-place. Keep only a small initial
// heap here instead of committing a corpus-sized reserve before the benchmark.
const heapReserve = 8 * MIB;

const wasm = readFileSync("build/classic/runtime.wasm");
const layouts = JSON.parse(readFileSync("build/classic/schema-layouts.json", "utf8"));
const schemas = createSchemaRegistry(layouts);
const runtime = new RawNodeBinding(wasm, { scratchCapacity, heapReserve });
const plainOptions = Object.freeze({ plain: true });
const eagerOptions = Object.freeze({ eager: true, validate: true });
const retainedOptions = Object.freeze({ eager: false, validate: true });
let sink = 0;

function consume(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value | 0 : 0;
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return typeof value.length === "number" ? value.length : Object.keys(value).length;
  return value ? 1 : 0;
}

function invoke(operation) {
  sink = (sink + consume(operation())) | 0;
}

function measure(corpus, format, kind, series, description, bytes, operation, benchmark = null) {
  let calibrationIterations = 1;
  let elapsed = 0;
  while (elapsed < 20) {
    const start = performance.now();
    for (let index = 0; index < calibrationIterations; index++) invoke(operation);
    elapsed = performance.now() - start;
    if (elapsed < 20) calibrationIterations *= 2;
  }
  const operations = Math.max(1, Math.ceil((calibrationIterations * targetMs) / elapsed));
  const warmup = operations > 2 ? Math.max(1, Math.floor(operations / 10)) : 0;
  for (let index = 0; index < warmup; index++) invoke(operation);
  const start = performance.now();
  for (let index = 0; index < operations; index++) invoke(operation);
  const measuredMs = performance.now() - start;
  const seconds = measuredMs / 1000;
  const mbps = (bytes * operations) / seconds / 1e6;
  const result = {
    payload: corpus.key,
    label: corpus.label,
    format,
    kind,
    series,
    benchmark,
    description,
    elapsed: measuredMs,
    bytes,
    operations,
    nsPerOp: (measuredMs * 1e6) / operations,
    mbps,
    gbps: mbps / 1000,
    opsPerSecond: operations / seconds,
    features: ["utf8", "stub-runtime", tierMetadata.kernelTier, `node-${inputKind}`],
  };
  const name = `${corpus.key}-${format}`.padEnd(24);
  console.log(`${name} ${kind.padEnd(11)} ${description.padEnd(30)} ${Math.round(mbps).toLocaleString().padStart(7)} MB/s`);
  return result;
}

function varyStringValue(source, ordinal) {
  let valueIndex = 0;
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) !== 34) continue;
    const start = ++index;
    let escaped = false;
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (escaped) escaped = false;
      else if (code === 92) escaped = true;
      else if (code === 34) break;
      index++;
    }
    let next = index + 1;
    while (next < source.length && [9, 10, 13, 32].includes(source.charCodeAt(next))) next++;
    if (source.charCodeAt(next) === 58) continue;
    for (let at = start; at < index; at++) {
      const code = source.charCodeAt(at);
      const replacement = code >= 48 && code <= 57 ? (code === 57 ? 48 : code + 1) : code >= 65 && code <= 90 ? (code === 90 ? 65 : code + 1) : code >= 97 && code <= 122 ? (code === 122 ? 97 : code + 1) : 0;
      if (replacement !== 0 && valueIndex++ === ordinal) return source.slice(0, at) + String.fromCharCode(replacement) + source.slice(at + 1);
    }
  }
  return ` ${source}`;
}

function changingInputs(source) {
  // json-as uses fixed input for the two min-only giant corpora. Avoid holding
  // four extra 49-66 MB strings for the same behavior.
  const strings = source.length > 8 * MIB ? [source] : Array.from({ length: 4 }, (_, index) => varyStringValue(source, index));
  const inputs = inputKind === "buffer" ? strings.map((value) => Buffer.from(value)) : strings;
  let index = 0;
  return () => {
    const value = inputs[index];
    index = (index + 1) % inputs.length;
    return value;
  };
}

function stableInput(source) {
  return inputKind === "buffer" ? Buffer.from(source) : source;
}

function parseTyped(schema, input, project = null) {
  const value = runtime.parse(schema, input);
  try {
    return project ? project(value) : value.__document;
  } finally {
    value.dispose();
  }
}

function parseDynamic(input, project = null, plain = false) {
  if (plain) {
    const value = runtime.parseDynamic(input, plainOptions);
    return project ? project(value) : value;
  }
  const value = runtime.parseDynamic(input);
  try {
    return project ? project(value) : value.type.length;
  } finally {
    value.dispose();
  }
}

function parseDynamicEager(input) {
  const value = runtime.parseDynamic(input, eagerOptions);
  try {
    return value._document();
  } finally {
    value.dispose();
  }
}

function parseDynamicRetained(input, project = null) {
  const value = runtime.parseDynamic(input, retainedOptions);
  try {
    return project ? project(value) : value.type.length;
  } finally {
    value.dispose();
  }
}

function stringifyTypedUncached(schema, value) {
  const output = runtime._serializeDocument(schema, value.__document, runtime.scratch);
  return schema.root === undefined ? output : output.slice(9, -1);
}

function stringifyDynamicUncached(value) {
  const capacity = runtime.scratchCapacity - 128;
  runtime._invalidateScratchInput();
  runtime._callWithMemoryRefresh(
    runtime._serializeDynamic,
    value._document(),
    runtime.scratch,
    capacity,
  );
  if (runtime._result(0) !== 0) throw new RangeError(`Raw dynamic stringify failed with status ${runtime._result(0)}`);
  const output = runtime._result(20);
  const length = runtime._result(24);
  return runtime._decodeUtf8(output, output + length);
}

function assertFixture(corpus, value) {
  if (corpus.expectedLength !== undefined && value.length !== corpus.expectedLength) throw new Error(`${corpus.key}: expected root length ${corpus.expectedLength}`);
  if (corpus.expectedSize !== undefined && Object.keys(value).length !== corpus.expectedSize) throw new Error(`${corpus.key}: expected root size ${corpus.expectedSize}`);
  for (const [field, expected] of Object.entries(corpus.expected ?? {})) {
    const actual = Array.isArray(value[field]) ? value[field].length : value[field];
    if (actual !== expected) throw new Error(`${corpus.key}: expected ${field}=${expected}, received ${actual}`);
  }
}

const results = [];
const skipped = [];
const payloads = [];

for (const corpus of selected) {
  const entries = Object.entries(corpus.files).filter(([format, file]) => selectedFormats.has(format) && statSync(resolve(payloadDirectory, file)).size <= maximumBytes);
  if (entries.length === 0) {
    skipped.push({ payload: corpus.key, reason: `all selected fixtures exceed JSON_TY_CLASSIC_MAX_BYTES=${maximumBytes}` });
    continue;
  }

  const fixtures = new Map(
    entries.map(([format, file]) => {
      const buffer = readFileSync(resolve(payloadDirectory, file));
      return [format, { format, file, buffer, source: buffer.toString("utf8"), bytes: buffer.length }];
    }),
  );
  const min = fixtures.get("min");
  const nativeMin = min ? JSON.parse(min.source) : null;
  if (nativeMin !== null) assertFixture(corpus, nativeMin);
  const schema = corpus.typed ? schemas.get(corpus.typed) : null;
  const lazySchema = corpus.typedLazy ? schemas.get(corpus.typedLazy) : schema;
  if (corpus.typed && !schema) throw new Error(`Missing classic schema ${corpus.typed}`);
  if (corpus.typedLazy && !lazySchema) throw new Error(`Missing classic lazy schema ${corpus.typedLazy}`);
  if (!schema) skipped.push({ payload: corpus.key, variant: "typed", reason: corpus.limitation });
  const projection = projections[corpus.key];
  let retainedTyped = null;
  let retainedDynamic = null;

  try {
    for (const fixture of fixtures.values()) {
      payloads.push({ key: corpus.key, label: corpus.label, format: fixture.format, bytes: fixture.bytes, file: fixture.file });
      const nextInput = changingInputs(fixture.source);
      const residentInput = stableInput(fixture.source);

      if (selectedVariants.has("native")) {
        results.push(measure(corpus, fixture.format, "deserialize", "native", "Built-in JSON (JS)", fixture.bytes, () => JSON.parse(nextInput())));
      }
      if (selectedVariants.has("eager")) {
        const graphBackend = eagerBackend === "graph";
        const operation = graphBackend
          ? () => parseDynamicEager(nextInput())
          : () => parseDynamic(nextInput(), null, true);
        results.push(measure(corpus, fixture.format, "deserialize", "eager", graphBackend ? "json-ty (validating eager graph)" : "json-ty (Wasm plain object)", fixture.bytes, operation));
      }
      if (selectedVariants.has("lazy")) {
        const operation = lazySchema ? () => parseTyped(lazySchema, residentInput) : () => parseDynamicRetained(residentInput);
        results.push(measure(corpus, fixture.format, "deserialize", "lazy", lazySchema ? "json-ty (typed view)" : "json-ty (dynamic view)", fixture.bytes, operation));
        if (projection) {
          const projected = lazySchema
            ? () => parseTyped(lazySchema, residentInput, projection)
            : () => parseDynamicRetained(residentInput, projection);
          results.push(measure(corpus, fixture.format, "deserialize", "lazy", lazySchema ? "json-ty (typed view + projection)" : "json-ty (dynamic view + projection)", fixture.bytes, projected, "projection"));
        }
      }
      if (selectedVariants.has("obj")) {
        results.push(measure(corpus, fixture.format, "deserialize", "obj", "json-ty (JSON.Obj)", fixture.bytes, () => parseDynamic(residentInput)));
        if (projection) {
          results.push(measure(corpus, fixture.format, "deserialize", "obj", "json-ty (JSON.Obj + projection)", fixture.bytes, () => parseDynamic(residentInput, projection), "projection"));
        }
        // json-as keeps a historical "pretty" JSON.Obj case for the two
        // min-only yyjson corpora, pointing it at the same minified fixture.
        if (fixture.format === "min" && corpus.objPrettyAlias && selectedFormats.has("pretty")) {
          payloads.push({ key: corpus.key, label: corpus.label, format: "pretty", bytes: fixture.bytes, file: fixture.file, aliasOf: "min" });
          results.push(measure(corpus, "pretty", "deserialize", "obj", "json-ty (JSON.Obj)", fixture.bytes, () => parseDynamic(residentInput, projection)));
        }
      }

      if (corpus.key === "twitter" && fixture.format === "min") {
        for (const [query, queryProjection] of Object.entries(twitterQueries)) {
          if (selectedVariants.has("lazy")) {
            results.push(measure(corpus, fixture.format, "deserialize", "lazy", `json-ty (${query})`, fixture.bytes, () => parseDynamicRetained(residentInput, queryProjection), query));
          }
          if (selectedVariants.has("obj")) {
            results.push(measure(corpus, fixture.format, "deserialize", "obj", `JSON.Obj (${query})`, fixture.bytes, () => parseDynamic(residentInput, queryProjection), query));
          }
        }
      }
    }

    if (min) {
      retainedTyped = schema ? runtime.parse(schema, min.buffer) : null;
      retainedDynamic = runtime.parseDynamic(min.buffer);
      const canonicalMin = JSON.stringify(nativeMin);
      const dynamicOutput = stringifyDynamicUncached(retainedDynamic);
      if (dynamicOutput !== canonicalMin) throw new Error(`${corpus.key}: JSON.Obj did not reproduce the fixture semantically`);
      if (retainedTyped) {
        const typedOutput = stringifyTypedUncached(schema, retainedTyped);
        if (typedOutput !== canonicalMin) throw new Error(`${corpus.key}: typed runtime did not reproduce the fixture semantically`);
      }
      if (selectedVariants.has("native")) results.push(measure(corpus, "min", "serialize", "native", "Built-in JSON (JS)", min.bytes, () => JSON.stringify(nativeMin)));
      if (selectedVariants.has("eager")) {
        results.push(measure(corpus, "min", "serialize", "eager", schema ? "json-ty (typed eager)" : "json-ty (dynamic fallback)", min.bytes, () => (schema ? stringifyTypedUncached(schema, retainedTyped) : stringifyDynamicUncached(retainedDynamic))));
      }
      if (selectedVariants.has("lazy")) {
        results.push(measure(corpus, "min", "serialize", "lazy", schema ? "json-ty (typed view)" : "json-ty (dynamic view)", min.bytes, () => (schema ? stringifyTypedUncached(schema, retainedTyped) : stringifyDynamicUncached(retainedDynamic))));
      }
      if (selectedVariants.has("obj")) results.push(measure(corpus, "min", "serialize", "obj", "json-ty (JSON.Obj)", min.bytes, () => stringifyDynamicUncached(retainedDynamic)));
    }
  } finally {
    retainedTyped?.dispose();
    retainedDynamic?.dispose();
  }
}

mkdirSync(dirname(reportPath), { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  tierMetadata,
  targetMs,
  inputKind,
  eagerBackend,
  payloadDirectory,
  maximumBytes: Number.isFinite(maximumBytes) ? maximumBytes : null,
  scratchCapacity,
  heapReserve,
  sink,
  series: classicSeries,
  coverage: {
    exactTyped: classicCorpora.filter(({ typed }) => typed).map(({ key }) => key),
    pendingTyped: classicCorpora.filter(({ typed }) => !typed).map(({ key, limitation }) => ({ key, reason: limitation })),
  },
  payloads,
  skipped,
  results,
};
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`> ${reportPath} (${results.length} measurements, sink=${sink})`);

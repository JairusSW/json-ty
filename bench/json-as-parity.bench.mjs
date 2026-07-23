import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { RawNodeBinding, createSchemaRegistry } from "../src/raw/node-binding.js";
import { parityPayloads } from "./parity/payloads.mjs";

const targetMs = Math.max(100, Number(process.env.JSON_TY_PARITY_MS ?? 500));
const minimumRatio = Number(process.env.JSON_TY_PARITY_RATIO ?? 1.5);
const jsonAsRoot = resolve(process.env.JSON_AS_ROOT ?? "../json-as");
const tierMetadata = JSON.parse(readFileSync("build/parity/kernel-tier.json", "utf8"));

function runJsonAsArtifact(file) {
  const artifact = resolve(jsonAsRoot, "build", file);
  if (!existsSync(artifact)) throw new Error(`Missing json-as artifact ${artifact}. Run json-as benchmarks first.`);
  let memory;
  let exports;
  const lines = [];
  const liftString = (pointer) => {
    if (!pointer) return null;
    const words = new Uint32Array(memory.buffer);
    const end = (pointer + words[(pointer - 4) >>> 2]) >>> 1;
    const units = new Uint16Array(memory.buffer, pointer, end - (pointer >>> 1));
    let output = "";
    for (let offset = 0; offset < units.length; offset += 1024) output += String.fromCharCode(...units.subarray(offset, offset + 1024));
    return output;
  };
  const module = new WebAssembly.Module(readFileSync(artifact));
  ({ exports } = new WebAssembly.Instance(module, {
    env: {
      abort(message, source, line) {
        throw new Error(`${liftString(message)} at ${liftString(source)}:${line}`);
      },
      "performance.now": () => performance.now(),
      "Date.now": () => Date.now(),
      "console.log": (pointer) => lines.push(liftString(pointer)),
      writeFile() {},
      readFile(pointer) {
        const bytes = readFileSync(resolve(jsonAsRoot, liftString(pointer)));
        const output = exports.__new(bytes.byteLength, 1) >>> 0;
        new Uint8Array(memory.buffer, output, bytes.byteLength).set(bytes);
        return output;
      },
    },
  }));
  memory = exports.memory;
  exports.start();

  const results = new Map();
  let description = null;
  for (const line of lines) {
    const heading = line.match(/Benchmarking (.+)$/);
    if (heading) description = heading[1];
    const completed = line.match(/@ ([\d,]+)MB\/s/);
    if (description && completed) {
      results.set(description, Number(completed[1].replaceAll(",", "")));
      description = null;
    }
  }
  return results;
}

function fastest(results, ...names) {
  const values = names.map((name) => results.get(name)).filter(Number.isFinite);
  if (values.length === 0) throw new Error(`json-as artifact did not report ${names.join(" or ")}`);
  return Math.max(...values);
}

function measure(bytes, operation) {
  let iterations = 1;
  let elapsed = 0;
  while (elapsed < 30) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) operation();
    elapsed = performance.now() - start;
    if (elapsed < 30) iterations *= 2;
  }
  iterations = Math.max(1, Math.ceil((iterations * targetMs) / elapsed));
  const start = performance.now();
  for (let index = 0; index < iterations; index++) operation();
  elapsed = performance.now() - start;
  return {
    mbps: (bytes * iterations) / (elapsed / 1000) / 1e6,
    nsPerOp: (elapsed * 1e6) / iterations,
    iterations,
  };
}

function measureBatch(bytes, batch, operation) {
  const result = measure(bytes * batch, operation);
  result.nsPerOp /= batch;
  result.iterations *= batch;
  return result;
}

const vec3As = runJsonAsArtifact("vec3.bench.incremental.simd.wasm");
const deserializeAs = runJsonAsArtifact("deserialize.bench.incremental.simd.wasm");
const serializeAs = runJsonAsArtifact("serialize.bench.incremental.simd.wasm");
const canadaAs = runJsonAsArtifact("canada.bench.incremental.simd.wasm");
const poetAs = runJsonAsArtifact("poet.bench.incremental.simd.wasm");

const jsonAs = {
  vec3: { parse: fastest(vec3As, "Deserialize Vec3"), serialize: fastest(vec3As, "Serialize Vec3") },
  small: {
    parse: fastest(deserializeAs, "Deseriaize Small Eager", "Deserialize Small Lazy"),
    serialize: fastest(serializeAs, "Serialize Small Eager", "Serialize Small Lazy"),
  },
  medium: {
    parse: fastest(deserializeAs, "Deserialize Medium Eager", "Deserialize Medium Lazy"),
    serialize: fastest(serializeAs, "Serialize Medium Eager", "Serialize Medium Lazy"),
  },
  large: {
    parse: fastest(deserializeAs, "Deserialize Large Eager", "Deserialize Large Lazy"),
    serialize: fastest(serializeAs, "Serialize Large Eager", "Serialize Large Lazy"),
  },
  canada: { parse: fastest(canadaAs, "Deserialize Canada (min)"), serialize: fastest(canadaAs, "Serialize Canada (min)") },
  poet: { parse: fastest(poetAs, "Deserialize Poet (min)"), serialize: fastest(poetAs, "Serialize Poet (min)") },
};

const payloadDirectory = resolve(jsonAsRoot, "assembly/__benches__/payloads");
const cases = [
  ...parityPayloads.map((payload) => ({ ...payload, rootArray: false })),
  {
    key: "canada",
    schema: "Canada",
    json: readFileSync(resolve(payloadDirectory, "canada.min.json"), "utf8"),
    rootArray: false,
  },
  {
    key: "poet",
    schema: "PoemArray",
    json: readFileSync(resolve(payloadDirectory, "poet.min.json"), "utf8"),
    rootArray: true,
  },
].map((item) => ({ ...item, bytes: Buffer.byteLength(item.json) }));

const runtime = new RawNodeBinding(readFileSync("build/parity/runtime.wasm"), { scratchCapacity: 16 << 20, heapReserve: 128 << 20 });
const schemas = createSchemaRegistry(JSON.parse(readFileSync("build/parity/schema-layouts.json", "utf8")));
const release = runtime.exports.releaseDocument;
const rows = [];

for (const item of cases) {
  const schema = schemas.get(item.schema);
  const parseSchema = schemas.get(`${item.schema}Lazy`) ?? schema;
  const length = item.rootArray ? runtime._writeRootArrayInput(item.json) : runtime._writeInput(item.json, false, 1);
  const parse = runtime.exports[`parse${schema.name}Trusted`];
  const serialize = runtime.exports[`serialize${schema.name}`];
  const benchmarkParseOwned = runtime.exports[`benchmarkParse${parseSchema.name}`];
  const benchmarkParse = runtime.exports[`benchmarkParseInto${parseSchema.name}`];
  const benchmarkSerialize = runtime.exports[`benchmarkSerialize${schema.name}`];
  const batch = Math.max(1, Math.min(1024, Math.floor(1_000_000 / item.bytes)));
  const hostParsed = measure(item.bytes, () => {
    const document = parse(runtime.scratch, length) >>> 0;
    if (document === 0) throw new Error(`${item.key} parse failed with status ${runtime._result(0)}`);
    release(document);
  });
  const ownedParsed = measureBatch(item.bytes, batch, () => {
    if (benchmarkParseOwned(runtime.scratch, length, batch) !== batch) throw new Error(`${item.key} owned batched parse failed`);
  });
  const parsed = measureBatch(item.bytes, batch, () => {
    if (benchmarkParse(runtime.scratch, length, runtime.heapBase, runtime.memory.buffer.byteLength - runtime.heapBase, batch) !== batch) {
      throw new Error(`${item.key} caller-owned-output batched parse failed`);
    }
  });

  const document = parse(runtime.scratch, length) >>> 0;
  if (document === 0) throw new Error(`${item.key} retained parse failed with status ${runtime._result(0)}`);
  serialize(document, runtime.scratch, runtime.scratchCapacity - 128);
  if (runtime._result(0) !== 0) throw new Error(`${item.key} serialize failed with status ${runtime._result(0)}`);
  const output = runtime._decodeUtf8(runtime._result(20), runtime._result(20) + runtime._result(24));
  const canonicalOutput = item.rootArray ? output.slice(9, -1) : output;
  if (canonicalOutput !== JSON.stringify(JSON.parse(item.json))) throw new Error(`${item.key} serialized output mismatch`);
  const hostSerialized = measure(item.bytes, () => {
    serialize(document, runtime.scratch, runtime.scratchCapacity - 128);
  });
  const serialized = measureBatch(item.bytes, batch, () => {
    if (benchmarkSerialize(document, runtime.scratch, runtime.scratchCapacity - 128, batch) !== batch) throw new Error(`${item.key} batched serialize failed`);
  });
  release(document);

  for (const [kind, result] of [
    ["parse", parsed],
    ["serialize", serialized],
  ]) {
    const baseline = jsonAs[item.key][kind];
    const host = kind === "parse" ? hostParsed : hostSerialized;
    rows.push({
      payload: item.key,
      kind,
      jsonTyMbps: result.mbps,
      jsonAsMbps: baseline,
      ratio: result.mbps / baseline,
      nsPerOp: result.nsPerOp,
      hostMbps: host.mbps,
      hostNsPerOp: host.nsPerOp,
      hostRatio: host.mbps / baseline,
      ...(kind === "parse"
        ? {
            ownedMbps: ownedParsed.mbps,
            ownedNsPerOp: ownedParsed.nsPerOp,
            ownedRatio: ownedParsed.mbps / baseline,
            parseSchema: parseSchema.name,
          }
        : {}),
    });
  }
}

console.log(`\nIn-Wasm kernel parity (required ratio ${minimumRatio.toFixed(2)}x; host lifecycle shown separately)`);
let failed = 0;
for (const row of rows) {
  const pass = row.ratio >= minimumRatio;
  if (!pass) failed++;
  const owned = row.kind === "parse" ? `, owned ${row.ownedRatio.toFixed(2)}x` : "";
  console.log(`${pass ? "PASS" : "FAIL"} ${row.payload.padEnd(7)} ${row.kind.padEnd(9)} kernel ${row.ratio.toFixed(2)}x${owned}, host ${row.hostRatio.toFixed(2)}x  ${Math.round(row.jsonTyMbps).toLocaleString()} vs ${Math.round(row.jsonAsMbps).toLocaleString()} MB/s`);
}

mkdirSync("build/logs", { recursive: true });
writeFileSync("build/logs/json-as-parity.json", JSON.stringify({ generatedAt: new Date().toISOString(), tierMetadata, minimumRatio, rows }, null, 2));
if (failed !== 0) throw new Error(`${failed}/${rows.length} json-as parity gates failed`);
console.log(`PASS ${rows.length}/${rows.length} resident kernel gates`);

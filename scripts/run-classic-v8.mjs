import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const targetMs = process.env.JSON_TY_BENCH_MS ?? "200";
const files = {
  twitter: "twitter.min.json",
  canada: "canada.min.json",
  citm_catalog: "citm_catalog.min.json",
  poet: "poet.min.json",
  github_events: "github_events.min.json",
  "gsoc-2018": "gsoc-2018.min.json",
  lottie: "lottie.min.json",
  otfcc: "otfcc.min.json",
  fgo: "fgo.min.json",
};

function parseList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const requested = process.env.JSON_TY_CLASSIC_V8_CORPUS
  ? parseList(process.env.JSON_TY_CLASSIC_V8_CORPUS)
  : process.env.JSON_TY_CLASSIC_FILTER
    ? parseList(process.env.JSON_TY_CLASSIC_FILTER)
    : Object.keys(files);
const unknown = requested.filter((corpus) => !files[corpus]);
if (unknown.length > 0) throw new Error(`unsupported V8 classic corpora: ${unknown.join(", ")}`);

const payloadRoot = resolve(process.env.JSON_TY_CLASSIC_PAYLOADS ?? "../json-as/assembly/__benches__/payloads");
const v8 = process.env.D8_BIN ?? "v8";
const v8Flags = parseList((process.env.JSON_TY_V8_FLAGS ?? "--no-liftoff").replaceAll(/\s+/g, ","));
const wasm = resolve(process.env.JSON_TY_CLASSIC_V8_WASM ?? "build/classic/runtime.wasm");
if (!existsSync(wasm)) throw new Error(`missing classic Wasm module ${wasm}`);
const maximumBytes = Number(process.env.JSON_TY_CLASSIC_MAX_BYTES ?? Number.POSITIVE_INFINITY);
const marker = "__JSON_TY_CLASSIC_V8__";
const corpora = [];

for (const corpus of requested) {
  const payload = resolve(payloadRoot, files[corpus]);
  if (!existsSync(payload)) throw new Error(`missing classic payload ${payload}`);
  if (statSync(payload).size > maximumBytes) {
    console.log(`- ${corpus}: skipped (${statSync(payload).size.toLocaleString()} bytes exceeds JSON_TY_CLASSIC_MAX_BYTES)`);
    continue;
  }

  console.log(`\n# ${corpus}`);
  const result = spawnSync(
    v8,
    [...v8Flags, "--module", "./bench/classic-v8.bench.js", "--", wasm, payload, corpus, targetMs],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 << 20 },
  );
  if (result.error) throw result.error;
  const lines = result.stdout.split(/\r?\n/);
  const line = lines.find((value) => value.startsWith(marker));
  process.stdout.write(`${lines.filter((value) => value && !value.startsWith(marker)).join("\n")}\n`);
  process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${v8} exited with ${result.status} while benchmarking ${corpus}`);
  if (!line) throw new Error(`V8 classic runner did not emit its result record for ${corpus}`);
  corpora.push(JSON.parse(line.slice(marker.length)));
}

if (corpora.length === 0) throw new Error("no V8 classic corpora matched the configured filters");
const report = {
  generatedAt: new Date().toISOString(),
  engine: "v8",
  engineVersion: spawnSync(v8, ["--version"], { encoding: "utf8" }).stdout.trim(),
  flags: v8Flags,
  wasm,
  targetMs: Number(targetMs),
  corpora,
  results: corpora.flatMap(({ results }) => results),
};
mkdirSync("build/logs", { recursive: true });
writeFileSync("build/logs/classic-v8.json", `${JSON.stringify(report, null, 2)}\n`);
console.log("> build/logs/classic-v8.json");

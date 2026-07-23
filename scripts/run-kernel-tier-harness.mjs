import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  PUBLICATION_REPORTS,
  benchmarkScopeEnvironment,
} from "./lib/benchmark-plan.mjs";

const scope = process.env.JSON_TY_TIER_HARNESS_SCOPE ?? "full";
if (scope !== "full" && scope !== "smoke") {
  throw new Error("JSON_TY_TIER_HARNESS_SCOPE must be full or smoke");
}

const variants = [
  { label: "current", kernelTier: "simd", role: "pre-port-compatible current engine configuration" },
  { label: "naive", kernelTier: "naive", role: "RFC scalar oracle" },
  { label: "swar", kernelTier: "swar", role: "portable optimized default" },
  { label: "simd", kernelTier: "simd", role: "explicit fastest feature tier" },
];
const fixedEnvironment = {
  ...benchmarkScopeEnvironment(scope === "smoke"),
  ...(scope === "full" ? {
    JSON_TY_BENCH_MS: "200",
    JSON_TY_LAZY_BENCH_MS: "250",
    JSON_TY_PARITY_MS: "500",
  } : {}),
  JSON_TY_PARITY_RATIO: "0",
  JSON_TY_CLASSIC_REPORT: "build/logs/kernel-tier-classic.json",
  ...(scope === "smoke" ? {
    JSON_TY_CLASSIC_FILTER: "twitter,canada,poet",
    JSON_TY_CLASSIC_MAX_BYTES: "4000000",
  } : {}),
};

function run(command, arguments_, environment = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: process.cwd(),
    env: { ...process.env, ...fixedEnvironment, ...environment },
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${command} ${arguments_.join(" ")} exited with ${result.status}`);
  }
  return result.stdout;
}

function timed(command, arguments_, environment = {}) {
  const start = performance.now();
  const output = run(command, arguments_, environment);
  return { durationMs: performance.now() - start, output };
}

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function artifact(directory, compile) {
  const metadata = json(`${directory}/kernel-tier.json`);
  return {
    compileMs: compile.durationMs,
    wasmBytes: statSync(`${directory}/runtime.wasm`).size,
    metadata,
  };
}

function oracleSummary(output) {
  const marker = "\nRFC oracle";
  const end = output.lastIndexOf(marker);
  if (end < 0) throw new Error("RFC oracle output is missing its summary marker");
  return JSON.parse(output.slice(0, end));
}

run("npm", ["run", "build:compiler"]);
const report = {
  generatedAt: new Date().toISOString(),
  scope,
  invariants: {
    sameSchemas: true,
    sameInputBytes: true,
    sameMemorySettings: true,
    sameRepetitions: true,
    benchmarkEnvironment: fixedEnvironment,
  },
  variants: [],
};

for (const variant of variants) {
  const environment = { JSON_TY_KERNEL_TIER: variant.kernelTier };
  process.stdout.write(`\n[${variant.label}] RFC oracle\n`);
  const rfcCompile = timed("node", ["scripts/build-rfc-oracle-runtime.mjs"], environment);
  const rfcOutput = run("node", ["src/raw/rfc-oracle.test.mjs"], environment);
  const rfcSummary = oracleSummary(rfcOutput);

  process.stdout.write(`[${variant.label}] raw\n`);
  const rawCompile = timed("node", ["scripts/build-raw-runtime.mjs"], environment);
  run("node", ["bench/raw-flat.bench.mjs"], environment);

  process.stdout.write(`[${variant.label}] overview\n`);
  const overviewCompile = timed("node", ["scripts/build-overview-runtime.mjs"], environment);
  run("node", ["bench/overview.bench.mjs"], environment);

  process.stdout.write(`[${variant.label}] classic\n`);
  const classicCompile = timed("node", ["scripts/build-classic-runtime.mjs"], environment);
  run("node", ["bench/classic.bench.mjs"], environment);

  process.stdout.write(`[${variant.label}] lazy + in-Wasm parity\n`);
  const parityCompile = timed("node", ["scripts/build-parity-runtime.mjs"], environment);
  run("node", ["bench/lazy.bench.mjs"], environment);
  run("node", ["bench/json-as-parity.bench.mjs"], environment);

  const entry = {
    ...variant,
    tierMetadata: json(`build/rfc-oracle/${variant.kernelTier}/kernel-tier.json`),
    correctness: {
      rfcOracle: /all public-interface cases passed/.test(rfcOutput),
      cases: 318,
      counts: rfcSummary.counts,
    },
    compileAndSize: {
      rfc: artifact(`build/rfc-oracle/${variant.kernelTier}`, rfcCompile),
      raw: artifact("build/raw", rawCompile),
      overview: artifact("build/overview", overviewCompile),
      classic: artifact("build/classic", classicCompile),
      parity: artifact("build/parity", parityCompile),
    },
    execution: {
      raw: json(PUBLICATION_REPORTS.raw),
      overview: json(PUBLICATION_REPORTS.overview),
      classic: json(fixedEnvironment.JSON_TY_CLASSIC_REPORT),
      lazy: json(PUBLICATION_REPORTS.lazy),
      parity: json(PUBLICATION_REPORTS.parity),
    },
  };
  for (const workload of Object.values(entry.execution)) {
    if (workload.tierMetadata.kernelTier !== variant.kernelTier) {
      throw new Error(`${variant.label} report contains stale tier metadata`);
    }
  }
  report.variants.push(entry);
}

mkdirSync("benchmark/results", { recursive: true });
const output = `benchmark/results/kernel-tier-${scope}.json`;
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n> ${output}`);
for (const variant of report.variants) {
  const sizes = Object.fromEntries(Object.entries(variant.compileAndSize).map(([name, value]) => [name, value.wasmBytes]));
  console.log(`${variant.label.padEnd(7)} RFC=${variant.correctness.rfcOracle ? "pass" : "fail"} sizes=${JSON.stringify(sizes)}`);
}

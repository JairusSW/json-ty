import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const BENCHMARK_SUITES = [
  "overview",
  "raw",
  "classic",
  "classic-v8",
  "lazy",
  "parity",
  "tiers",
  "kernels",
  "publish",
  "all",
];

export const PUBLICATION_REPORTS = Object.freeze({
  overview: "build/logs/overview.json",
  raw: "build/logs/raw.json",
  classic: "build/logs/classic.json",
  "classic-v8": "build/logs/classic-v8.json",
  lazy: "build/logs/lazy.json",
  parity: "build/logs/json-as-parity.json",
  tiers: "benchmark/results/kernel-tier-full.json",
});

export const CHART_NAMES = Object.freeze([
  "overview-deserialize",
  "overview-serialize",
  "classic-payload-deserialize",
  "classic-payload-serialize",
  "classic-v8-deserialize",
  "classic-v8-serialize",
  "lazy-access-pattern",
  "json-as-parity-parse",
  "json-as-parity-serialize",
  "raw-deserialize",
  "raw-serialize",
  "tier-compile-time",
  "tier-wasm-size",
  "tier-execution",
  "rfc-coverage",
]);

export const PUBLICATION_CHARTS = Object.freeze(
  CHART_NAMES.flatMap((name) => [`build/charts/${name}.svg`, `build/charts/${name}.png`]),
);

const smokeEnvironment = Object.freeze({
  JSON_TY_BENCH_MS: "25",
  JSON_TY_LAZY_BENCH_MS: "25",
  JSON_TY_PARITY_MS: "50",
  JSON_TY_PARITY_RATIO: "0",
});

export function benchmarkScopeEnvironment(smoke) {
  return smoke ? { ...smokeEnvironment } : {};
}

const command = (label, executable, arguments_, environment = {}) => ({
  label,
  executable,
  arguments_,
  environment,
});

export function workloadPlan(name, smoke) {
  const smokeEnv = benchmarkScopeEnvironment(smoke);
  switch (name) {
    case "overview":
      return {
        compiler: true,
        reports: ["build/logs/overview.json"],
        steps: [
          command("build runtime", "node", ["./scripts/build-overview-runtime.mjs"]),
          command("measure", "node", ["./bench/overview.bench.mjs"], smoke ? {
            ...smokeEnv,
            JSON_TY_OVERVIEW_FILTER: "small,medium,large",
          } : {}),
        ],
      };
    case "raw":
      return {
        compiler: true,
        reports: ["build/logs/raw.json"],
        steps: [
          command("build runtime", "node", ["./scripts/build-raw-runtime.mjs"]),
          command("measure", "node", ["./bench/raw-flat.bench.mjs"], smokeEnv),
        ],
      };
    case "classic":
      return {
        compiler: true,
        reports: [smoke ? "build/logs/classic-smoke.json" : PUBLICATION_REPORTS.classic],
        steps: [
          command("build runtime", "node", ["./scripts/build-classic-runtime.mjs"]),
          command("measure", "node", ["./bench/classic.bench.mjs"], smoke ? {
            ...smokeEnv,
            JSON_TY_CLASSIC_REPORT: "build/logs/classic-smoke.json",
            JSON_TY_CLASSIC_FILTER: "twitter,canada,poet",
            JSON_TY_CLASSIC_MAX_BYTES: "4000000",
          } : {}),
        ],
      };
    case "classic-v8":
      return {
        compiler: true,
        reports: [PUBLICATION_REPORTS["classic-v8"]],
        steps: [
          command("build runtime", "node", ["./scripts/build-classic-runtime.mjs"], { JSON_TY_KERNEL_TIER: "simd" }),
          command("projection contract", "node", ["./bench/classic-v8-projections.test.mjs"]),
          command("measure", "node", ["./scripts/run-classic-v8.mjs"], smoke ? {
            ...smokeEnv,
            JSON_TY_CLASSIC_FILTER: "twitter,canada,poet",
          } : {}),
        ],
      };
    case "lazy":
      return {
        compiler: true,
        reports: [PUBLICATION_REPORTS.lazy],
        steps: [
          command("build runtime", "node", ["./scripts/build-parity-runtime.mjs"]),
          command("measure", "node", ["./bench/lazy.bench.mjs"], smokeEnv),
        ],
      };
    case "parity":
      return {
        compiler: true,
        reports: [PUBLICATION_REPORTS.parity],
        steps: [
          command("build runtime", "node", ["./scripts/build-parity-runtime.mjs"]),
          command("measure", "node", ["./bench/json-as-parity.bench.mjs"], smokeEnv),
        ],
      };
    case "tiers":
      return {
        compiler: false,
        reports: [smoke ? "benchmark/results/kernel-tier-smoke.json" : PUBLICATION_REPORTS.tiers],
        steps: [
          command("measure", "node", ["./scripts/run-kernel-tier-harness.mjs"], {
            JSON_TY_TIER_HARNESS_SCOPE: smoke ? "smoke" : "full",
          }),
        ],
      };
    case "kernels":
      return {
        compiler: false,
        reports: [],
        steps: [command("microbenchmarks", "npm", ["run", "bench:swar-port"])],
      };
    default:
      throw new Error(`Unknown benchmark workload ${name}`);
  }
}

export function suiteWorkloads(target) {
  if (target === "publish" || target === "all") {
    return [
      "overview",
      "raw",
      "classic",
      "classic-v8",
      "lazy",
      "parity",
      "tiers",
      ...(target === "all" ? ["kernels"] : []),
    ];
  }
  return [target];
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function writeBenchmarkRunManifest(target, smoke, reportPaths) {
  const reports = reportPaths.map((path) => {
    if (!existsSync(path)) throw new Error(`Benchmark workload did not produce ${path}`);
    JSON.parse(readFileSync(path, "utf8"));
    return { path, sha256: digest(path) };
  });
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    target,
    scope: smoke ? "smoke" : "full",
    reports,
  };
  mkdirSync("build/logs", { recursive: true });
  writeFileSync("build/logs/benchmark-run.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function validatePublicationReports() {
  const manifestPath = "build/logs/benchmark-run.json";
  if (!existsSync(manifestPath)) {
    throw new Error("Missing benchmark run manifest. Run `npm run bench:run -- publish --no-charts` first.");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== 1 || manifest.scope !== "full" || !["publish", "all"].includes(manifest.target)) {
    throw new Error("Charts require a full `publish` or `all` benchmark run manifest.");
  }
  const recorded = new Map(manifest.reports.map((report) => [report.path, report.sha256]));
  for (const [name, path] of Object.entries(PUBLICATION_REPORTS)) {
    if (!existsSync(path)) throw new Error(`Missing ${name} benchmark report ${path}`);
    JSON.parse(readFileSync(path, "utf8"));
    const expected = recorded.get(path);
    if (expected === undefined) throw new Error(`Run manifest does not own ${path}`);
    if (digest(path) !== expected) throw new Error(`Benchmark report changed after the run manifest was written: ${path}`);
  }
  return manifest;
}

export function validatePublicationCharts() {
  for (const path of PUBLICATION_CHARTS) {
    if (!existsSync(path)) throw new Error(`Missing publication chart ${path}`);
  }
}

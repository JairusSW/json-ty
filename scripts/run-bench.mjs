import { spawnSync } from "node:child_process";
import {
  BENCHMARK_SUITES,
  suiteWorkloads,
  workloadPlan,
  writeBenchmarkRunManifest,
} from "./lib/benchmark-plan.mjs";

let target = "overview";
let smoke = false;
let buildCharts = true;

function usage() {
  console.log(`Usage: ./scripts/run-bench.sh [suite] [options]

Suites:
  overview     Small/medium/large host benchmark (default)
  raw          Raw binding benchmark
  classic      Complete classic corpus
  classic-v8   Resident V8 classic corpus
  lazy         Eager/lazy access matrix
  parity       json-ty versus json-as
  tiers        Naive/SWAR/SIMD compile, size, and execution matrix
  kernels      Standalone kernel microbenchmarks
  publish      Every report required by the chart publisher
  all          Publish reports plus kernel microbenchmarks

Options:
  --smoke      Use bounded representative workloads where supported
  --no-charts  Do not render charts after the selected suite
  --list       Print suite names
  -h, --help   Show this help`);
}

const arguments_ = process.argv.slice(2);
while (arguments_.length > 0) {
  const argument = arguments_.shift();
  if (BENCHMARK_SUITES.includes(argument)) target = argument;
  else if (argument === "--smoke") smoke = true;
  else if (argument === "--no-charts") buildCharts = false;
  else if (argument === "--list") {
    console.log(BENCHMARK_SUITES.join("\n"));
    process.exit(0);
  } else if (argument === "-h" || argument === "--help") {
    usage();
    process.exit(0);
  } else {
    console.error(`Unknown benchmark argument: ${argument}`);
    usage();
    process.exit(1);
  }
}

const failures = [];
let compilerReady;

function banner(label) {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  ${label}`);
  console.log("═══════════════════════════════════════════════════════════════");
}

function run(label, executable, commandArguments, environment = {}) {
  banner(label);
  const result = spawnSync(executable, commandArguments, {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error);
    failures.push(label);
    return false;
  }
  if (result.status !== 0) {
    console.error(`❌ FAILED: ${label}`);
    failures.push(label);
    return false;
  }
  return true;
}

function ensureCompiler() {
  if (compilerReady !== undefined) return compilerReady;
  compilerReady = run("compiler: build", "npm", ["run", "build:compiler"]);
  return compilerReady;
}

const reports = [];
for (const workload of suiteWorkloads(target)) {
  const plan = workloadPlan(workload, smoke);
  if (plan.compiler && !ensureCompiler()) {
    failures.push(`${workload}: skipped after compiler failure`);
    continue;
  }
  let completed = true;
  for (const step of plan.steps) {
    if (!run(`${workload}: ${step.label}`, step.executable, step.arguments_, step.environment)) {
      completed = false;
      break;
    }
  }
  if (completed) reports.push(...plan.reports);
}

if (failures.length === 0) {
  try {
    writeBenchmarkRunManifest(target, smoke, reports);
  } catch (error) {
    console.error(error);
    failures.push("benchmark report manifest");
  }
}

if (buildCharts && failures.length === 0) {
  if (smoke) {
    console.log("Skipping charts for smoke scope; smoke reports cannot replace publication reports.");
  } else if (target === "overview") {
    run("charts: overview", "bash", ["./scripts/build-charts.sh", "overview"]);
  } else if (target === "publish" || target === "all") {
    run("charts: publication", "bash", ["./scripts/build-charts.sh", "publish"]);
  } else {
    console.log(`No publication chart set is defined for the individual '${target}' suite.`);
  }
}

console.log("\n═══════════════════════════════════════════════════════════════");
if (failures.length === 0) {
  console.log(`✅ Benchmark suite '${target}' completed.`);
} else {
  console.log(`⚠️  ${failures.length} benchmark step(s) failed:`);
  for (const failure of failures) console.log(`   - ${failure}`);
  process.exitCode = 1;
}

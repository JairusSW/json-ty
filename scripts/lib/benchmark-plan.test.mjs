import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BENCHMARK_SUITES,
  PUBLICATION_CHARTS,
  PUBLICATION_REPORTS,
  suiteWorkloads,
  validatePublicationReports,
  workloadPlan,
  writeBenchmarkRunManifest,
} from "./benchmark-plan.mjs";

assert.equal(new Set(BENCHMARK_SUITES).size, BENCHMARK_SUITES.length);
assert.deepEqual(suiteWorkloads("publish"), [
  "overview",
  "raw",
  "classic",
  "classic-v8",
  "lazy",
  "parity",
  "tiers",
]);
assert.equal(PUBLICATION_CHARTS.length, 30);
assert.equal(new Set(PUBLICATION_CHARTS).size, PUBLICATION_CHARTS.length);

for (const workload of ["overview", "classic", "classic-v8"]) {
  const fullLabels = workloadPlan(workload, false).steps.map((step) => step.label);
  const smokeLabels = workloadPlan(workload, true).steps.map((step) => step.label);
  assert.ok(
    fullLabels.some((label) => label.includes("gate")),
    `${workload} full run must enforce a performance gate`,
  );
  assert.ok(
    !smokeLabels.some((label) => label.includes("gate")),
    `${workload} smoke run must not enforce noisy performance gates`,
  );
}

const previous = process.cwd();
const temporary = mkdtempSync(join(tmpdir(), "json-ty-benchmark-plan-"));
try {
  process.chdir(temporary);
  for (const [name, path] of Object.entries(PUBLICATION_REPORTS)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ name })}\n`);
  }
  const paths = Object.values(PUBLICATION_REPORTS);
  writeBenchmarkRunManifest("publish", false, paths);
  assert.equal(validatePublicationReports().scope, "full");

  writeFileSync(PUBLICATION_REPORTS.raw, '{"changed":true}\n');
  assert.throws(
    () => validatePublicationReports(),
    /changed after the run manifest/,
    "publication must reject stale or replaced reports",
  );

  writeBenchmarkRunManifest("publish", true, paths);
  assert.throws(
    () => validatePublicationReports(),
    /full `publish` or `all`/,
    "publication must reject smoke provenance",
  );
} finally {
  process.chdir(previous);
  rmSync(temporary, { recursive: true, force: true });
}

console.log("benchmark publication contract: all tests passed");

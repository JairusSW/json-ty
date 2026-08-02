import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildProject } from "../dist/compiler/build.js";

const allCases = [
  { file: "bool", suites: 8, assertions: 28 },
  { file: "null", suites: 9, assertions: 49 },
  { file: "date", suites: 6, assertions: 39 },
  { file: "types", suites: 7, assertions: 22 },
  { file: "tiny-payloads", suites: 7, assertions: 51 },
  { file: "array", suites: 46, assertions: 147 },
  { file: "integer", suites: 39, assertions: 175 },
  { file: "box", suites: 10, assertions: 33 },
  { file: "raw", suites: 9, assertions: 28 },
  { file: "map", suites: 17, assertions: 96 },
  { file: "set", suites: 28, assertions: 106 },
  { file: "whitespace", suites: 13, assertions: 58 },
  { file: "enum", suites: 8, assertions: 31 },
  { file: "struct", suites: 29, assertions: 187 },
  { file: "decorators", suites: 5, assertions: 17 },
  { file: "hierarchy", suites: 10, assertions: 26 },
  { file: "generics", suites: 8, assertions: 41 },
  { file: "namespace", suites: 11, assertions: 29 },
  { file: "resolving", suites: 8, assertions: 23 },
  { file: "override", suites: 10, assertions: 30 },
  { file: "arbitrary", suites: 23, assertions: 130 },
  { file: "dynamic-interop", suites: 13, assertions: 67 },
  { file: "dynamic-string-class", suites: 2, assertions: 13 },
  { file: "json-runtime", suites: 49, assertions: 140 },
  { file: "jsonarray-extra", suites: 40, assertions: 77 },
  { file: "jsonarray-index", suites: 3, assertions: 8 },
  { file: "jsonarray-methods", suites: 6, assertions: 27 },
  { file: "objindex-property", suites: 6, assertions: 17 },
  { file: "parse-reuse", suites: 6, assertions: 21 },
  { file: "containers-runtime", suites: 3, assertions: 22 },
  { file: "custom", suites: 19, assertions: 51 },
  { file: "fast-path-deserialize", suites: 32, assertions: 175 },
  { file: "gc-stress", suites: 8, assertions: 25 },
  { file: "lazy-fields", suites: 19, assertions: 63 },
  { file: "production-safety", suites: 2, assertions: 5 },
  { file: "roundtrip-fuzz", suites: 5, assertions: 3 },
  { file: "roundtrip-matrix", suites: 3, assertions: 39 },
];
const assemblyScriptOnly = ["atoi-fast", "float", "lazy-slot-encoding", "parseinto", "staticarray", "string", "swar-int", "swar", "typedarray"];
assert.equal(allCases.length + assemblyScriptOnly.length, 46, "complete behavioral suite inventory");
for (const file of assemblyScriptOnly) {
  assert.ok(existsSync(resolve(`tests/integration/assemblyscript-contracts/${file}.spec.ts`)), `missing ${file} contract snapshot`);
}
const requested = new Set(process.argv.slice(2));
const cases = requested.size === 0 ? allCases : allCases.filter((test) => requested.has(test.file));
if (requested.size !== 0 && cases.length !== requested.size) {
  const known = new Set(cases.map((test) => test.file));
  throw new Error(`Unknown integration suite(s): ${[...requested].filter((name) => !known.has(name)).join(", ")}`);
}

const root = resolve("build/integration-tests");
mkdirSync(root, { recursive: true });

async function build(test) {
  const directory = resolve(root, test.file);
  const app = resolve(directory, "app");
  const configPath = resolve(directory, "tsconfig.json");
  mkdirSync(directory, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    extends: resolve("tests/integration/tsconfig.json"),
    compilerOptions: { outDir: app },
    files: [
      resolve("tests/integration/globals.d.ts"),
      resolve("tests/integration/harness.ts"),
      resolve(`tests/integration/${test.file}.spec.ts`),
    ],
  }));
  const result = await buildProject({
    configPath,
    generatedDirectory: resolve(directory, "generated"),
    cacheDirectory: resolve(directory, "cache"),
  });
  return { app, result, test };
}

async function run({ app, result, test }) {
  const emitted = resolve(app, `tests/integration/${test.file}.spec.js`);
  await import(pathToFileURL(emitted).href);
  const harness = await import(pathToFileURL(resolve(app, "tests/integration/harness.js")).href);
  harness.runSuites();
  const counts = harness.testCounts();
  assert.equal(counts.suites, test.suites, `${test.file} suite count`);
  assert.ok(counts.assertions >= test.assertions, `${test.file} assertion count`);
  return { ...counts, file: test.file, kernelTier: result.kernelTier };
}

// asc maintains process-global compiler state, so builds are serialized here.
// Every suite still gets a separate generated runtime and module artifact.
const concurrency = 1;
const pending = [...cases];
const builds = [];
await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
  while (pending.length !== 0) {
    const test = pending.shift();
    try { builds.push(await build(test)); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = error instanceof Error && error.stack ? `\n${error.stack}` : "";
      throw new Error(`${test.file}: ${message}${detail}`);
    }
  }
}));

const results = [];
for (const built of builds) results.push(await run(built));

results.sort((left, right) => left.file.localeCompare(right.file));
const totals = results.reduce((sum, result) => ({ suites: sum.suites + result.suites, assertions: sum.assertions + result.assertions }), { suites: 0, assertions: 0 });
for (const result of results) console.log(`  ${result.file}: ${result.suites} suites, ${result.assertions} assertions`);
console.log(`integration: ${totals.suites} suites, ${totals.assertions} assertions passed (${results[0]?.kernelTier ?? "unknown"})`);

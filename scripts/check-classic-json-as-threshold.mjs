import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const report = JSON.parse(readFileSync("build/logs/classic-v8.json", "utf8"));
const jsonAsRoot = resolve(process.env.JSON_AS_ROOT ?? "../json-as");
const tier = process.env.JSON_AS_CLASSIC_TIER ?? "simd";
const minimum = Number(process.env.JSON_TY_CLASSIC_MIN_JSON_AS_RATIO ?? "1");
const selected = new Set(
  (process.env.JSON_TY_CLASSIC_GATE_FILTER ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const failures = [];

function jsonAsResult(corpus, variant) {
  const infix = variant === "eager" ? "" : `-${variant}`;
  const path = resolve(jsonAsRoot, `build/logs/as/${tier}/${corpus}${infix}-min.deserialize.as.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

for (const corpus of report.corpora) {
  if (selected.size > 0 && !selected.has(corpus.corpus)) continue;
  const jsonTy = corpus.results
    .filter(({ name }) => name === "json-ty-dynamic" || name === "json-ty-into" || name === "json-ty-lazy-into" || name === "json-ty-projected")
    .sort((left, right) => right.mbps - left.mbps)[0];
  const jsonAs = ["eager", "lazy", "obj"]
    .map((variant) => ({ variant, result: jsonAsResult(corpus.corpus, variant) }))
    .filter(({ result }) => result !== null)
    .sort((left, right) => right.result.mbps - left.result.mbps)[0];
  if (!jsonTy || !jsonAs) {
    failures.push(`${corpus.corpus}: missing json-ty or json-as result`);
    continue;
  }
  const ratio = jsonTy.mbps / jsonAs.result.mbps;
  const passed = ratio >= minimum;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${corpus.corpus.padEnd(14)} ${ratio.toFixed(2)}x  ${Math.round(jsonTy.mbps).toLocaleString()} vs ${Math.round(jsonAs.result.mbps).toLocaleString()} MB/s (${jsonTy.name} vs json-as ${jsonAs.variant})`,
  );
  if (!passed) failures.push(`${corpus.corpus}: ${ratio.toFixed(2)}x < ${minimum.toFixed(2)}x`);
}

if (failures.length > 0) {
  throw new Error(`classic json-as performance gate failed:\n- ${failures.join("\n- ")}`);
}

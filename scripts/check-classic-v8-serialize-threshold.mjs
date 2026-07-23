import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const report = JSON.parse(readFileSync("build/logs/classic-v8.json", "utf8"));
const jsonAsRoot = resolve(process.env.JSON_AS_ROOT ?? "../json-as");
const tier = process.env.JSON_AS_CLASSIC_TIER ?? "simd";
const minimum = Number(process.env.JSON_TY_CLASSIC_MIN_NATIVE_RATIO ?? "1");
const failures = [];

function jsonAsResult(corpus, variant) {
  const infix = variant === "eager" ? "" : `-${variant}`;
  const path = resolve(jsonAsRoot, `build/logs/as/${tier}/${corpus}${infix}-min.serialize.as.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

for (const corpus of report.corpora) {
  const native = corpus.results.find(({ name }) => name === "native-serialize");
  const jsonTy = corpus.results.find(({ name }) => name === "json-ty-serialize");
  const jsonAs = ["eager", "lazy", "obj"]
    .map((variant) => ({ variant, result: jsonAsResult(corpus.corpus, variant) }))
    .filter(({ result }) => result !== null)
    .sort((left, right) => right.result.mbps - left.result.mbps)[0];
  if (!native || !jsonTy || !jsonAs) {
    failures.push(`${corpus.corpus}: missing native, json-ty, or json-as serialization result`);
    continue;
  }
  const nativeRatio = jsonTy.mbps / native.mbps;
  const jsonAsRatio = jsonTy.mbps / jsonAs.result.mbps;
  const passed = nativeRatio >= minimum && jsonAsRatio >= minimum;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${corpus.corpus.padEnd(14)} JS ${nativeRatio.toFixed(2)}x  json-as ${jsonAsRatio.toFixed(2)}x  ${Math.round(jsonTy.mbps).toLocaleString()} MB/s`,
  );
  if (!passed) failures.push(`${corpus.corpus}: JS ${nativeRatio.toFixed(2)}x, json-as ${jsonAsRatio.toFixed(2)}x`);
}

if (failures.length > 0) {
  throw new Error(`classic V8 serialization gate failed:\n- ${failures.join("\n- ")}`);
}

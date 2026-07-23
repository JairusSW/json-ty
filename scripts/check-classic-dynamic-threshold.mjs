import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync("build/logs/classic-v8.json", "utf8"));
const minimum = Number(process.env.JSON_TY_CLASSIC_MIN_NATIVE_RATIO ?? "1");
const selected = new Set(
  (process.env.JSON_TY_CLASSIC_GATE_FILTER ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const failures = [];

for (const corpus of report.corpora) {
  if (selected.size > 0 && !selected.has(corpus.corpus)) continue;
  const native = corpus.results.find(({ name }) => name === "native");
  const dynamic = corpus.results.find(({ name }) => name === "json-ty-dynamic");
  if (!native || !dynamic) {
    failures.push(`${corpus.corpus}: missing native or dynamic result`);
    continue;
  }
  const ratio = dynamic.mbps / native.mbps;
  const passed = ratio >= minimum;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${corpus.corpus.padEnd(14)} ${ratio.toFixed(2)}x  ${Math.round(dynamic.mbps).toLocaleString()} vs ${Math.round(native.mbps).toLocaleString()} MB/s`,
  );
  if (!passed) failures.push(`${corpus.corpus}: ${ratio.toFixed(2)}x < ${minimum.toFixed(2)}x`);
}

if (failures.length > 0) {
  throw new Error(`classic validated lazy JSON.Obj gate failed:\n- ${failures.join("\n- ")}`);
}

import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync("build/logs/classic-v8.json", "utf8"));
const minimum = Number(process.env.JSON_TY_CLASSIC_MIN_NATIVE_RATIO ?? "1");
const filter = new Set(
  (process.env.JSON_TY_CLASSIC_GATE_FILTER ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const typedCorpora = new Set(["canada", "poet"]);
const failures = [];

for (const corpus of report.corpora) {
  if (filter.size > 0 && !filter.has(corpus.corpus)) continue;
  const native = corpus.results.find(({ name }) => name === "native");
  const raw = corpus.results.find(({ name }) => name === "json-ty-raw");
  if (!native || !raw) {
    failures.push(`${corpus.corpus}: missing native or raw-validation result`);
    continue;
  }

  const rawRatio = raw.mbps / native.mbps;
  console.log(`${corpus.corpus.padEnd(14)} raw validation ${rawRatio.toFixed(2)}x native JSON.parse`);
  if (rawRatio < minimum) failures.push(`${corpus.corpus}: raw validation ${rawRatio.toFixed(2)}x < ${minimum.toFixed(2)}x`);

  if (typedCorpora.has(corpus.corpus)) {
    const materialized = corpus.results.find(({ name }) => name === "json-ty-into");
    if (!materialized) {
      failures.push(`${corpus.corpus}: missing typed caller-owned result`);
      continue;
    }
    const materializedRatio = materialized.mbps / native.mbps;
    console.log(`${"".padEnd(14)} typed document ${materializedRatio.toFixed(2)}x native JSON.parse`);
    if (materializedRatio < minimum) {
      failures.push(`${corpus.corpus}: typed document ${materializedRatio.toFixed(2)}x < ${minimum.toFixed(2)}x`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`classic V8 performance gate failed:\n- ${failures.join("\n- ")}`);
}

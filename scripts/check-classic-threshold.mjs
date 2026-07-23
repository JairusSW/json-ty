import { readFileSync } from "node:fs";

const reportPath = process.env.JSON_TY_CLASSIC_REPORT ?? "build/logs/classic.json";
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const requiredRatio = Number(process.env.JSON_TY_CLASSIC_MIN_NATIVE_RATIO ?? "1");
const requiredSeries = process.env.JSON_TY_CLASSIC_REQUIRED_SERIES;
const selected = new Set(
  (process.env.JSON_TY_CLASSIC_GATE_FILTER ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const rows = report.results.filter(
  (row) =>
    row.kind === "deserialize" &&
    row.format === "min" &&
    row.benchmark === null &&
    (selected.size === 0 || selected.has(row.payload)),
);
const payloads = [...new Set(rows.map(({ payload }) => payload))];
if (payloads.length === 0) throw new Error("classic threshold selected no minified deserialization rows");

let failures = 0;
for (const payload of payloads) {
  const matching = rows.filter((row) => row.payload === payload);
  const native = matching.find((row) => row.series === "native");
  const candidates = matching.filter(
    (row) =>
      row.series !== "native" &&
      (requiredSeries === undefined || row.series === requiredSeries),
  );
  if (!native || candidates.length === 0) {
    throw new Error(
      `${payload}: threshold requires native and ${requiredSeries ?? "json-ty"} rows`,
    );
  }
  const best = candidates.reduce((left, right) => (left.mbps >= right.mbps ? left : right));
  const ratio = best.mbps / native.mbps;
  const passed = ratio >= requiredRatio;
  if (!passed) failures++;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${payload.padEnd(14)} ${ratio.toFixed(2)}x  ${Math.round(best.mbps).toLocaleString()} vs ${Math.round(native.mbps).toLocaleString()} MB/s (${best.series})`,
  );
}
if (failures !== 0) {
  throw new Error(`${failures}/${payloads.length} classic deserialization corpora are below ${requiredRatio.toFixed(2)}x native`);
}

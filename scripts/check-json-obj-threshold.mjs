import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync("build/logs/overview.json", "utf8"));
const rows = report.results.filter((row) => row.kind === "deserialize");
const failures = [];
const minimumByPayload = new Map([
  ["small", 1.5],
  ["medium", 2.5],
  ["large", 2.5],
]);

for (const payload of report.payloads) {
  const native = rows.find((row) => row.payload === payload.key && row.series === "native");
  const dynamic = rows.find((row) => row.payload === payload.key && row.series === "dynamic-string");
  if (!native || !dynamic) continue;
  const ratio = dynamic.mbps / native.mbps;
  const minimum = minimumByPayload.get(payload.key) ?? 1;
  console.log(`${payload.key.padEnd(8)} JSON.Obj / JS ${ratio.toFixed(2)}x (minimum ${minimum.toFixed(2)}x)`);
  if (ratio < minimum) failures.push(`${payload.key}: ${ratio.toFixed(2)}x < ${minimum.toFixed(2)}x`);
}

if (failures.length !== 0) {
  throw new Error(`JSON.Obj parse throughput gate failed:\n${failures.join("\n")}`);
}

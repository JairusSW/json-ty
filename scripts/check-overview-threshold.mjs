import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync("build/logs/overview.json", "utf8"));
const threshold = Number(process.env.JSON_TY_MIN_NATIVE_RATIO ?? 1.5);

function result(payload, kind, series) {
  return report.results.find((entry) => entry.payload === payload && entry.kind === kind && entry.series === series);
}

function check(label, kind, candidateSeries) {
  const rows = report.payloads.flatMap((payload) => {
    const native = result(payload.key, kind, "native");
    const candidate = result(payload.key, kind, candidateSeries);
    if (!native || !candidate) return [];
    return [{ payload: payload.key, native: native.mbps, candidate: candidate.mbps, ratio: candidate.mbps / native.mbps }];
  });
  const passed = rows.filter((row) => row.ratio >= threshold).length;
  const required = Math.floor(rows.length / 2) + 1;

  console.log(`\n${label} (requires ${threshold.toFixed(2)}x on ${required}/${rows.length} corpora)`);
  for (const row of rows) {
    const mark = row.ratio >= threshold ? "PASS" : "    ";
    console.log(`  ${mark} ${row.payload.padEnd(8)} ${row.ratio.toFixed(2)}x  ${Math.round(row.candidate).toLocaleString()} vs ${Math.round(row.native).toLocaleString()} MB/s`);
  }
  if (passed < required) throw new Error(`${label}: only ${passed}/${rows.length} corpora reached ${threshold.toFixed(2)}x native`);
  console.log(`  PASS ${passed}/${rows.length} corpora`);
}

check("Typed Buffer parse", "deserialize", "typed-buffer");
check("Typed resident string parse", "deserialize", "typed-string");
check("Cached typed-view stringify", "serialize", "retained-cached");

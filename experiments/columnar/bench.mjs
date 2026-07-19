// Columnar / dataframe-lite: parse a JSON array of records into typed-array
// columns, then run analytical ops (sum / mean / filter-count) — vs native
// JSON.parse + iterate. The eager flat buffer is already column-friendly, so we
// never build JS objects. Win compounds when you run many ops on one parse.
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { registerSchema, parseColumnar } from "../../src/wasm/eager-rt.js";
import { createBarChart, generateChart } from "../lib/chart.mjs";
import { bar } from "../lib/palette.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function makeRecords(n) {
  const a = new Array(n);
  for (let i = 0; i < n; i++) a[i] = { id: i, x: (i % 100) * 1.5, y: (n - i) * 0.25, name: "u" + i, active: (i & 1) === 0 };
  return JSON.stringify(a);
}
const N = Number(process.argv[2]) || 5000, json = makeRecords(N), bytes = Buffer.byteLength(json, "utf8");
const SID = registerSchema(["id", "x", "y", "name", "active"]);      // x=col1, y=col2, active=col4
const bb = (z) => z;
const t = (fn, n) => { let w = Math.max(1, n / 10 | 0); while (w-- > 0) fn(); const s = performance.now(); let c = n; while (c-- > 0) fn(); return performance.now() - s; };
const best = (fn, n) => Math.min(t(fn, n), t(fn, n));
const OPS = 3000, mbps = (ms) => (bytes * OPS) / (ms / 1000) / 1e6;

// === (A) end-to-end: parse + one analytics pass (sum+mean+count) — MB/s ===
const e2eNative = () => {
  const a = JSON.parse(json);
  let sx = 0, sy = 0, na = 0;
  for (let i = 0; i < a.length; i++) { sx += a[i].x; sy += a[i].y; if (a[i].active) na++; }
  return bb(sx + sy / a.length + na);
};
const e2eCol = () => {
  const df = parseColumnar(SID, json);
  return bb(df.sum(1) + df.sum(2) / df.count + df.countWhere(4, (v) => v !== 0));
};
if (Math.abs(e2eNative() - e2eCol()) > 1e-6) { console.log("MISMATCH:", e2eNative(), e2eCol()); process.exit(1); }
const e2eN = mbps(best(e2eNative, OPS)), e2eC = mbps(best(e2eCol, OPS));

// === (B) post-parse query throughput (Mrows/s) — parse ONCE, query many ===
// the real columnar win: typed-array columns vs object property access.
const nativeArr = JSON.parse(json);                 // parsed once
const df = parseColumnar(SID, json);                // parsed once
const colX = df.numCol(1), colA = df.boolCol(4);    // extracted once
const QOPS = Math.max(200, (4e8 / N) | 0), mrows = (ms) => (N * QOPS) / (ms / 1000) / 1e6;

const qSumNat = () => { let s = 0; for (let i = 0; i < nativeArr.length; i++) s += nativeArr[i].x; return bb(s); };
const qSumCol = () => { let s = 0; for (let i = 0; i < colX.length; i++) s += colX[i]; return bb(s); };
const qFiltNat = () => { let n = 0; for (let i = 0; i < nativeArr.length; i++) if (nativeArr[i].active && nativeArr[i].x > 50) n++; return bb(n); };
const qFiltCol = () => { let n = 0; for (let i = 0; i < colX.length; i++) if (colA[i] && colX[i] > 50) n++; return bb(n); };

console.log(`Columnar over ${N} records (${(bytes / 1024).toFixed(0)} KB)\n`);
console.log(`end-to-end (parse + sum+mean+count):  native ${Math.round(e2eN)} | columnar ${Math.round(e2eC)} MB/s  (${(e2eC / e2eN).toFixed(2)}x)\n`);
console.log("post-parse query (Mrows/s)   native   columnar   speedup");
console.log("-".repeat(56));
const results = [{ label: "end-to-end (parse+1 query)", native: e2eN, columnar: e2eC, unit: "MB/s" }];
for (const [nat, col, label] of [[qSumNat, qSumCol, "sum column"], [qFiltNat, qFiltCol, "filter count"]]) {
  const n = mrows(best(nat, QOPS)), c = mrows(best(col, QOPS)), f = (v) => v.toFixed(0).padStart(7);
  console.log(`${label.padEnd(20)} ${f(n)}Mr/s ${f(c)}Mr/s   ${(c / n).toFixed(2)}x`);
  results.push({ label: "query: " + label, native: n, columnar: c, unit: "Mrows/s" });
}

// chart: post-parse query throughput (Mrows/s) — native objects vs typed columns
const data = {}, labels = {};
for (const r of results.filter((r) => r.unit === "Mrows/s")) { data[r.label] = [r.native, r.columnar]; labels[r.label] = r.label; }
const config = createBarChart(data, labels, {
  title: `Columnar — post-parse query throughput (${N} records, Mrows/s)`,
  yLabel: "Mrows/s", xLabel: "",
  datasetLabels: ["native (array of objects)", "json-ty columnar (typed arrays)"],
  colors: [bar("strawberryRed"), bar("jungleGreen")],
});
generateChart(config, join(HERE, "columnar.png"));
mkdirSync(join(HERE, "build"), { recursive: true });
writeFileSync(join(HERE, "build/columnar.json"), JSON.stringify(results, null, 2));
console.log("\nwrote columnar.png");

// Mutable in-place document: patch a field and re-emit by splicing the source,
// vs native JSON.parse -> mutate -> JSON.stringify (which rebuilds the whole
// object tree and re-stringifies everything). The pass-through / gateway case.
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseDoc } from "../../src/wasm/eager-rt.js";
import { createBarChart, generateChart } from "../lib/chart.mjs";
import { bar } from "../lib/palette.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// A config-ish doc with F top-level fields (the bigger it is, the more native
// wastes rebuilding untouched fields).
function makeDoc(F) {
  const o = {};
  for (let i = 0; i < F; i++) o["field_" + i] = i % 3 === 0 ? "value_string_number_" + i + "_abcdefghij" : i % 3 === 1 ? i * 1000 + 0.5 : (i & 1) === 0;
  return o;
}

const bb = (z) => z;
const t = (fn, n) => { let w = Math.max(1, n / 10 | 0); while (w-- > 0) fn(); const s = performance.now(); let c = n; while (c-- > 0) fn(); return performance.now() - s; };
const best = (fn, n) => Math.min(t(fn, n), t(fn, n));

console.log("Patch one field + re-emit — MB/s. native = parse+mutate+stringify;");
console.log("json-ty = scan spans + splice source\n");
console.log("fields  bytes   native    json-ty   speedup");
console.log("-".repeat(48));
const results = [];
for (const F of [10, 50, 200, 1000]) {
  const obj = makeDoc(F);
  const json = JSON.stringify(obj);
  const keys = Object.keys(obj);
  const target = keys[(F / 2) | 0];
  const newVal = "PATCHED_" + Date.now() % 1000;

  const native = () => { const o = JSON.parse(json); o[target] = newVal; return bb(JSON.stringify(o)); };
  const ours = () => bb(parseDoc(keys, json).set(target, newVal).emit());

  // correctness: emitted doc parses to the same object native would produce
  const want = JSON.parse(native());
  const got = JSON.parse(ours());
  if (JSON.stringify(want) !== JSON.stringify(got)) { console.log(`  MISMATCH F=${F}`); continue; }

  const bytes = Buffer.byteLength(json, "utf8");
  const ops = Math.min(2_000_000, Math.max(3000, Math.round((40 << 20) / bytes)));
  const mbps = (ms) => (bytes * ops) / (ms / 1000) / 1e6;
  const n = mbps(best(native, ops)), o = mbps(best(ours, ops));
  console.log(`${String(F).padStart(5)} ${String(bytes).padStart(6)} ${String(Math.round(n)).padStart(7)}MB/s ${String(Math.round(o)).padStart(7)}MB/s   ${(o / n).toFixed(2)}x`);
  results.push({ label: `${F} fields (${(bytes / 1024).toFixed(1)}KB)`, native: n, "json-ty": o });
}

const data = {}, labels = {};
for (const r of results) { data[r.label] = [r.native, r["json-ty"]]; labels[r.label] = r.label; }
const config = createBarChart(data, labels, {
  title: "Patch one field + re-emit — json-ty splice vs native round-trip",
  yLabel: "MB/s", xLabel: "",
  datasetLabels: ["native parse+mutate+stringify", "json-ty scan+splice"],
  colors: [bar("strawberryRed"), bar("pacificBlue", 0.9)],
});
generateChart(config, join(HERE, "mutable-doc.png"));
mkdirSync(join(HERE, "build"), { recursive: true });
writeFileSync(join(HERE, "build/mutable-doc.json"), JSON.stringify(results, null, 2));
console.log("\nwrote mutable-doc.png");

// Eager flat-buffer parser: bulk numeric + full read-all, vs native JSON.parse
// and the lazy json-ty engine.
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { registerSchema, parseArray, parseObject, num, bool, str, sumColumn } from "./reader.mjs";
import { makeView, parse as lazyParse, LEAF } from "../../src/wasm/runtime.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- synthetic array of N flat records ----------------------------------
function makeRecords(n) {
  const a = new Array(n);
  for (let i = 0; i < n; i++) a[i] = { id: i, x: i * 1.5, y: (n - i) * 0.25, name: "user_" + i, active: (i & 1) === 0 };
  return JSON.stringify(a);
}
const N = 2000;
const arrJson = makeRecords(N);
const FIELDS = ["id", "x", "y", "name", "active"];           // M = 5
const X = 1, NAME = 3;                                       // column indices

const EAGER_SID = registerSchema(FIELDS);
// lazy equivalent: an array-of-struct view
const LazyRec = makeView(FIELDS, [LEAF, LEAF, LEAF, LEAF, LEAF], { id: ["num", 0], x: ["num", 1], y: ["num", 2], name: ["str", 3], active: ["bool", 4] }, "Rec");

const bb = (z) => z;
const t = (fn, n) => { let w = Math.max(1, n / 10 | 0); while (w-- > 0) fn(); const s = performance.now(); let c = n; while (c-- > 0) fn(); return performance.now() - s; };
const best = (fn, n) => Math.min(t(fn, n), t(fn, n));
const results = [];

// === 1. bulk numeric: sum the x column ===
const sumNative = () => { const a = JSON.parse(arrJson); let s = 0; for (let i = 0; i < a.length; i++) s += a[i].x; return bb(s); };
const sumEager = () => { const h = parseArray(EAGER_SID, arrJson); return bb(sumColumn(h, X)); };
const sumLazy = () => { const r = lazyParseArrayRecords(arrJson); let s = 0; for (let i = 0; i < r.length; i++) s += r[i].x; return bb(s); };
function lazyParseArrayRecords(json) {
  // mirror the eager array via the lazy engine's struct-array
  return globalThis.__lazyArr(json);
}
// build a lazy struct-array reader using runtime.parseStructArray
import { parseStructArray as lazyStructArray } from "../../src/wasm/runtime.js";
globalThis.__lazyArr = (json) => lazyStructArray(LazyRec.__sid, LazyRec, json);

// === 2. full read-all: read every field of every record ===
const allNative = () => { const a = JSON.parse(arrJson); let s = 0; for (let i = 0; i < a.length; i++) { const o = a[i]; s += o.id + o.x + o.y + o.name.length + (o.active ? 1 : 0); } return bb(s); };
const allEager = () => { const h = parseArray(EAGER_SID, arrJson); let s = 0; for (let r = 0; r < h.count; r++) s += num(h, r, 0) + num(h, r, 1) + num(h, r, 2) + str(h, r, NAME).length + (bool(h, r, 4) ? 1 : 0); return bb(s); };
const allLazy = () => { const r = __lazyArr(arrJson); let s = 0; for (let i = 0; i < r.length; i++) { const o = r[i]; s += o.id + o.x + o.y + o.name.length + (o.active ? 1 : 0); } return bb(s); };

// correctness
for (const [a, b, c, nm] of [[sumNative, sumEager, sumLazy, "sum"], [allNative, allEager, allLazy, "all"]]) {
  if (Math.abs(a() - b()) > 1e-6 || Math.abs(a() - c()) > 1e-6) { console.log(`MISMATCH ${nm}:`, a(), b(), c()); process.exit(1); }
}

const bytes = Buffer.byteLength(arrJson, "utf8");
const OPS = 4000;
const mbps = (ms) => (bytes * OPS) / (ms / 1000) / 1e6;
console.log(`Array of ${N} flat records (${(bytes / 1024).toFixed(1)} KB) — MB/s\n`);
console.log("task             native     lazy        eager       eager/native");
console.log("-".repeat(64));
for (const [nat, lazy, eager, nm] of [[sumNative, sumLazy, sumEager, "sum x column"], [allNative, allLazy, allEager, "read all fields"]]) {
  const n = mbps(best(nat, OPS)), l = mbps(best(lazy, OPS)), e = mbps(best(eager, OPS));
  const f = (v) => String(Math.round(v)).padStart(8);
  console.log(`${nm.padEnd(16)} ${f(n)}MB/s ${f(l)}MB/s ${f(e)}MB/s   ${(e / n).toFixed(2)}x`);
  results.push({ task: nm, native: n, lazy: l, eager: e });
}

mkdirSync(join(HERE, "build/logs"), { recursive: true });
writeFileSync(join(HERE, "build/logs/eager.json"), JSON.stringify(results, null, 2));
console.log("\nwrote build/logs/eager.json");

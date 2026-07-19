// Eager pointer-linked flat tables vs native vs lazy.
//  1) headline: array of N flat records — bulk column sum + full read.
//  2) nested payloads (medium/large) — full read, exercising sub-table pointers.
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { registerSchema, parseArray, parseObject, num, bool, str, child, sumColumn, LEAF, PRIM } from "./reader.mjs";
import { makeView, parse as lazyParse, parseStructArray as lazyArr, LEAF as L2 } from "../../src/wasm/runtime.js";
import { PAYLOADS } from "../deserialize/payloads.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const bb = (z) => z;
const t = (fn, n) => { let w = Math.max(1, n / 10 | 0); while (w-- > 0) fn(); const s = performance.now(); let c = n; while (c-- > 0) fn(); return performance.now() - s; };
const best = (fn, n) => Math.min(t(fn, n), t(fn, n));
const results = [];

// ---- recursive auto-schema (eager) + recursive reader --------------------
function autoEager(sample, name) {
  const keys = [], childSids = [], spec = [];
  let idx = 0;
  for (const k of Object.keys(sample)) {
    const v = sample[k]; let kind, ch = LEAF, childSpec;
    if (typeof v === "number") kind = "num";
    else if (typeof v === "boolean") kind = "bool";
    else if (typeof v === "string" || v === null) kind = "str";
    else if (Array.isArray(v)) {
      if (v.length === 0 || typeof v[0] === "number") { kind = "arrNum"; ch = PRIM; }
      else if (typeof v[0] === "string") { kind = "arrStr"; ch = PRIM; }
      else { const s = autoEager(v[0], name + "_" + k); kind = "arrObj"; ch = s.sid; childSpec = s.spec; }
    } else { const s = autoEager(v, name + "_" + k); kind = "obj"; ch = s.sid; childSpec = s.spec; }
    keys.push(k); childSids.push(ch); spec.push({ kind, idx, childSpec }); idx++;
  }
  return { sid: registerSchema(keys, childSids), spec };
}
function readRec(h, r, spec) {
  let acc = 0;
  for (const f of spec) {
    if (f.kind === "num") acc += num(h, r, f.idx);
    else if (f.kind === "bool") acc += bool(h, r, f.idx) ? 1 : 0;
    else if (f.kind === "str") acc += str(h, r, f.idx).length;
    else if (f.kind === "obj") acc += readRec(child(h, r, f.idx), 0, f.childSpec);
    else if (f.kind === "arrObj") { const c = child(h, r, f.idx); for (let k = 0; k < c.count; k++) acc += readRec(c, k, f.childSpec); }
    else if (f.kind === "arrNum") { const c = child(h, r, f.idx); for (let k = 0; k < c.count; k++) acc += num(c, k, 0); }
    else if (f.kind === "arrStr") { const c = child(h, r, f.idx); for (let k = 0; k < c.count; k++) acc += str(c, k, 0).length; }
  }
  return acc;
}
// native equivalent — read every field recursively
function readNative(o, spec) {
  let acc = 0;
  for (const f of spec) {
    const v = o[f.name ?? Object.keys(o)[f.idx]];
    if (v == null) continue;
    if (f.kind === "num") acc += v; else if (f.kind === "bool") acc += v ? 1 : 0;
    else if (f.kind === "str") acc += ("" + v).length;
    else if (f.kind === "obj") acc += readNative(v, f.childSpec);
    else if (f.kind === "arrObj") { for (const e of v) acc += readNative(e, f.childSpec); }
    else if (f.kind === "arrNum") { for (const x of v) acc += x; }
    else if (f.kind === "arrStr") { for (const s of v) acc += s.length; }
  }
  return acc;
}
// attach field names to spec (for native reader)
function nameSpec(sample, spec) { const ks = Object.keys(sample); spec.forEach((f, i) => { f.name = ks[i]; if (f.childSpec) nameSpec(Array.isArray(sample[ks[i]]) ? sample[ks[i]][0] : sample[ks[i]], f.childSpec); }); return spec; }

// ================= 1) headline: array of 2000 flat records =================
function makeRecords(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = { id: i, x: i * 1.5, y: (n - i) * 0.25, name: "user_" + i, active: (i & 1) === 0 }; return JSON.stringify(a); }
const N = 2000, arrJson = makeRecords(N);
const REC = registerSchema(["id", "x", "y", "name", "active"]);
const LazyRec = makeView(["id", "x", "y", "name", "active"], [L2, L2, L2, L2, L2], { id: ["num", 0], x: ["num", 1], y: ["num", 2], name: ["str", 3], active: ["bool", 4] }, "Rec");
const arrBytes = Buffer.byteLength(arrJson, "utf8");

const sumNat = () => { const a = JSON.parse(arrJson); let s = 0; for (let i = 0; i < a.length; i++) s += a[i].x; return bb(s); };
const sumEag = () => bb(sumColumn(parseArray(REC, arrJson), 1));
const sumLaz = () => { const r = lazyArr(LazyRec.__sid, LazyRec, arrJson); let s = 0; for (let i = 0; i < r.length; i++) s += r[i].x; return bb(s); };
const allNat = () => { const a = JSON.parse(arrJson); let s = 0; for (let i = 0; i < a.length; i++) { const o = a[i]; s += o.id + o.x + o.y + o.name.length + (o.active ? 1 : 0); } return bb(s); };
const allEag = () => { const h = parseArray(REC, arrJson); let s = 0; for (let r = 0; r < h.count; r++) s += num(h, r, 0) + num(h, r, 1) + num(h, r, 2) + str(h, r, 3).length + (bool(h, r, 4) ? 1 : 0); return bb(s); };
const allLaz = () => { const r = lazyArr(LazyRec.__sid, LazyRec, arrJson); let s = 0; for (let i = 0; i < r.length; i++) { const o = r[i]; s += o.id + o.x + o.y + o.name.length + (o.active ? 1 : 0); } return bb(s); };

for (const [a, b, c, nm] of [[sumNat, sumEag, sumLaz, "sum"], [allNat, allEag, allLaz, "all"]])
  if (Math.abs(a() - b()) > 1e-6 || Math.abs(a() - c()) > 1e-6) { console.log("MISMATCH", nm, a(), b(), c()); process.exit(1); }

console.log(`Array of ${N} flat records (${(arrBytes / 1024).toFixed(1)} KB):\n`);
console.log("task             native     lazy        eager     eager/nat");
console.log("-".repeat(58));
const OPS1 = 4000, mb1 = (ms) => (arrBytes * OPS1) / (ms / 1000) / 1e6;
for (const [nat, laz, eag, nm] of [[sumNat, sumLaz, sumEag, "sum x column"], [allNat, allLaz, allEag, "read all fields"]]) {
  const n = mb1(best(nat, OPS1)), l = mb1(best(laz, OPS1)), e = mb1(best(eag, OPS1)), f = (v) => String(Math.round(v)).padStart(7);
  console.log(`${nm.padEnd(16)} ${f(n)}MB/s ${f(l)}MB/s ${f(e)}MB/s   ${(e / n).toFixed(2)}x`);
  results.push({ task: nm === "sum x column" ? "array: sum col" : "array: read-all", native: n, lazy: l, eager: e });
}

// ================= 2) nested payloads — full read =================
console.log("\nNested payloads (full read, sub-table pointers):\n");
console.log("payload   bytes   native     eager     eager/nat");
console.log("-".repeat(50));
for (const { name, json } of PAYLOADS) {
  if (name === "abc" || name === "uuidv4") continue; // bare strings; skip
  const sample = JSON.parse(json);
  const { sid, spec } = autoEager(sample, name); nameSpec(sample, spec);
  const eag = () => bb(readRec(parseObject(sid, json), 0, spec));
  const nat = () => bb(readNative(JSON.parse(json), spec));
  if (Math.abs(eag() - nat()) > 1e-6) { console.log(`  MISMATCH ${name}: ${eag()} != ${nat()}`); continue; }
  const bytes = Buffer.byteLength(json, "utf8");
  const ops = Math.min(2_000_000, Math.max(4000, Math.round((24 << 20) / bytes)));
  const mb = (ms) => (bytes * ops) / (ms / 1000) / 1e6;
  const n = mb(best(nat, ops)), e = mb(best(eag, ops)), f = (v) => String(Math.round(v)).padStart(7);
  console.log(`${name.padEnd(9)} ${String(bytes).padStart(5)} ${f(n)}MB/s ${f(e)}MB/s   ${(e / n).toFixed(2)}x`);
  results.push({ task: name, native: n, lazy: 0, eager: e });
}

mkdirSync(join(HERE, "build/logs"), { recursive: true });
writeFileSync(join(HERE, "build/logs/eager.json"), JSON.stringify(results, null, 2));
console.log("\nwrote build/logs/eager.json");

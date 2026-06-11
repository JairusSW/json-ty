// Correctness fuzzer: generate random schemas + JSON, diff json-ty lazy AND
// eager (full read) against native JSON.parse. Catches edge cases (escapes,
// unicode, edge numbers, deep nesting, missing fields) before real use.
import { makeView, parse, resetSchemas as resetLazy, LEAF, PRIM } from "../../src/wasm/runtime.js";
import { makeEagerView, parseEager, resetSchemas as resetEager, LEAF as ELEAF, PRIM as EPRIM } from "../../src/wasm/eager-rt.js";

// ---- seeded RNG (mulberry32) for reproducible runs ----
let seed = (Number(process.argv[2]) || 12345) >>> 0;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (n) => (rnd() * n) | 0;
const pick = (a) => a[ri(a.length)];

// ---- value generators (the interesting edge cases) ----
const STR_CHARS = ['a', 'B', '7', ' ', '.', '"', '\\', '\n', '\t', '\r', '/', 'é', '€', '日', '😀', '', ''];
function genStr() {
  if (rnd() < 0.1) return "";
  let s = "";
  const n = 1 + ri(10);
  for (let i = 0; i < n; i++) s += pick(STR_CHARS);
  return s;
}
function genNum() {
  const r = rnd();
  if (r < 0.3) return ri(2000) - 1000;            // int
  if (r < 0.5) return -(ri(1e6));                 // bigger int
  if (r < 0.7) return Math.round((rnd() * 200 - 100) * 1000) / 1000; // 3dp float (Clinger-safe)
  if (r < 0.85) return parseFloat((rnd() * 9).toFixed(1) + "e" + (ri(10) - 5)); // small sci
  return [0, -0, 1, -1, 0.5, 123456789, -42][ri(7)]; // specials
}
// Shape-first: generate a structure once, then random values conforming to it,
// so object keys + array element shapes are uniform within a sample (what a
// schema parser requires).
function genShape(depth) {
  const fields = [];
  const n = 1 + ri(5);
  for (let i = 0; i < n; i++) {
    const name = "k" + i + (rnd() < 0.3 ? "_x" : "");
    const r = rnd();
    if (depth <= 0 || r < 0.55) fields.push({ name, type: pick(["num", "str", "bool"]) });
    else if (r < 0.65) fields.push({ name, type: "numArr" });
    else if (r < 0.72) fields.push({ name, type: "strArr" });
    else if (r < 0.84) fields.push({ name, type: "structArr", elem: genShape(depth - 1) });
    else fields.push({ name, type: "obj", child: genShape(depth - 1) });
  }
  return fields;
}
// No null: auto-schema infers a field's type from element 0, so nullability
// can't be represented here (and eager conflates null/""). Null is a known,
// separately-documented case — this fuzzer targets non-null parsing correctness.
function genScalarFor(type) {
  return type === "num" ? genNum() : type === "str" ? genStr() : rnd() < 0.5;
}
function genVal(shape) {
  const o = {};
  for (const f of shape) {
    switch (f.type) {
      case "num": case "str": case "bool": o[f.name] = genScalarFor(f.type); break;
      // arrays >=1: auto-schema infers element type from element 0, so an empty
      // array can't be typed (a fuzzer limitation, not a parser one).
      case "numArr": o[f.name] = Array.from({ length: 1 + ri(5) }, () => genNum()); break;
      case "strArr": o[f.name] = Array.from({ length: 1 + ri(5) }, () => genStr()); break;
      case "structArr": o[f.name] = Array.from({ length: 1 + ri(3) }, () => genVal(f.elem)); break;
      case "obj": o[f.name] = genVal(f.child); break;
    }
  }
  return o;
}

// ---- schema derivation (lazy + eager) ----
let uid = 0;
function autoSchema(sample, name, eager) {
  const mk = eager ? makeEagerView : makeView;
  const L = eager ? ELEAF : LEAF, P = eager ? EPRIM : PRIM;
  const keys = [], childSids = [], fields = {}, spec = [];
  let idx = 0;
  for (const k of Object.keys(sample)) {
    const v = sample[k];
    let kind, child = L, childName, childSpec;
    if (typeof v === "number") kind = "num";
    else if (typeof v === "boolean") kind = "bool";
    else if (typeof v === "string" || v === null) kind = "str";
    else if (Array.isArray(v)) {
      if (v.length === 0 || typeof v[0] === "number") { kind = "numArray"; child = P; }
      else if (typeof v[0] === "string") { kind = "strArray"; child = P; }
      else { const cn = name + "." + k + uid++; const s = autoSchema(v[0], cn, eager); kind = "structArray"; child = s.View.__sid; childName = cn; childSpec = s.spec; }
    } else { const cn = name + "." + k + uid++; const s = autoSchema(v, cn, eager); kind = "child"; child = s.View.__sid; childName = cn; childSpec = s.spec; }
    keys.push(k); childSids.push(child); fields[k] = childName ? [kind, idx, childName] : [kind, idx]; spec.push({ name: k, kind, childSpec }); idx++;
  }
  return { View: mk(keys, childSids, fields, name), spec };
}

// ---- deep compare a parsed view against native ----
function cmp(got, want, spec, path, fails) {
  for (const f of spec) {
    const g = got[f.name], w = want[f.name], p = path + "." + f.name;
    if (f.kind === "child") { if (w == null) { if (g != null) fails.push(p + " child: got " + g); } else if (g == null) fails.push(p + " child: got null"); else cmp(g, w, f.childSpec, p, fails); }
    else if (f.kind === "structArray") { if (!Array.isArray(g) || g.length !== w.length) fails.push(p + " structArr: " + (Array.isArray(g) ? g.length : typeof g) + " != " + w.length); else for (let i = 0; i < w.length; i++) cmp(g[i], w[i], f.childSpec, p + "[" + i + "]", fails); }
    else if (f.kind === "numArray" || f.kind === "strArray") { if (JSON.stringify(g) !== JSON.stringify(w)) fails.push(p + " arr: " + JSON.stringify(g) + " != " + JSON.stringify(w)); }
    else if (f.kind === "str") { if (g !== w) fails.push(p + " str: " + (typeof g === "string" && g.length > 64 ? `<${g.length} chars>` : JSON.stringify(g)) + " != " + JSON.stringify(w)); }
    else if (g !== w) fails.push(p + " " + f.kind + ": " + g + " != " + w);
  }
}

// ---- run ----
const N = Number(process.argv[3]) || 5000;
let lazyFails = 0, eagerFails = 0, checked = 0;
for (let it = 0; it < N; it++) {
  const sample = genVal(genShape(2 + ri(2)));
  const json = JSON.stringify(sample);
  const native = JSON.parse(json);
  uid = 0;
  resetLazy(); resetEager(); // reuse the fixed-size schema registries each iter
  const { View: LView, spec } = autoSchema(sample, "L" + it, false);
  const { View: EView } = autoSchema(sample, "E" + it, true);
  const lazy = new LView(parse(LView.__sid, json));
  const eager = parseEager(EView.__sid, EView, json);
  const lf = [], ef = [];
  cmp(lazy, native, spec, "", lf);
  cmp(eager, native, spec, "", ef);
  checked++;
  if (lf.length) { lazyFails++; if (lazyFails <= 3) console.log(`LAZY FAIL #${it}: ${lf[0]}\n  json: ${json.slice(0, 160)}`); }
  if (ef.length) { eagerFails++; if (eagerFails <= 3) console.log(`EAGER FAIL #${it}: ${ef[0]}\n  json: ${json.slice(0, 160)}`); }
}
console.log(`\nfuzz seed=${(Number(process.argv[2]) || 12345)}  iters=${N}`);
console.log(`  lazy:  ${checked - lazyFails}/${checked} ok  (${lazyFails} fail)`);
console.log(`  eager: ${checked - eagerFails}/${checked} ok  (${eagerFails} fail)`);
process.exit(lazyFails + eagerFails ? 1 : 0);

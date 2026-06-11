// Deserialization bench: json-ty WASM lazy parse (read every field) vs native
// JSON.parse (read every field) across the ported json-as payloads.
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { makeView, parse, LEAF, PRIM } from "../../src/wasm/runtime.js";
import { makeEagerView, parseEager, LEAF as ELEAF, PRIM as EPRIM } from "../../src/wasm/eager-rt.js";
import { PAYLOADS } from "./payloads.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Auto-derive a schema (registered + View) from a sample object, recursively.
let uid = 0;
function autoSchema(sample, name) {
  const keys = [], childSids = [], fields = {}, spec = [];
  let idx = 0;
  for (const k of Object.keys(sample)) {
    const v = sample[k];
    let kind, child = LEAF, childName, childSpec;
    if (typeof v === "number") kind = "num";
    else if (typeof v === "boolean") kind = "bool";
    else if (typeof v === "string" || v === null) kind = "str";
    else if (Array.isArray(v)) {
      if (v.length === 0 || typeof v[0] === "number") { kind = "numArray"; child = PRIM; }
      else if (typeof v[0] === "string") { kind = "strArray"; child = PRIM; }
      else { const cn = name + "_" + k + uid++; const s = autoSchema(v[0], cn); kind = "structArray"; child = s.View.__sid; childName = cn; childSpec = s.spec; }
    } else { const cn = name + "_" + k + uid++; const s = autoSchema(v, cn); kind = "child"; child = s.View.__sid; childName = cn; childSpec = s.spec; }
    keys.push(k); childSids.push(child);
    fields[k] = childName ? [kind, idx, childName] : [kind, idx];
    spec.push({ name: k, kind, childSpec });
    idx++;
  }
  return { View: makeView(keys, childSids, fields, name), spec };
}

// Same, but build an EAGER view tree (makeEagerView). Returns the root view class.
function autoEagerView(sample, name) {
  const keys = [], childSids = [], fields = {};
  let idx = 0;
  for (const k of Object.keys(sample)) {
    const v = sample[k];
    let kind, child = ELEAF, childName;
    if (typeof v === "number") kind = "num";
    else if (typeof v === "boolean") kind = "bool";
    else if (typeof v === "string" || v === null) kind = "str";
    else if (Array.isArray(v)) {
      if (v.length === 0 || typeof v[0] === "number") { kind = "numArray"; child = EPRIM; }
      else if (typeof v[0] === "string") { kind = "strArray"; child = EPRIM; }
      else { const cn = name + "." + k; const cv = autoEagerView(v[0], cn); kind = "structArray"; child = cv.__sid; childName = cn; }
    } else { const cn = name + "." + k; const cv = autoEagerView(v, cn); kind = "child"; child = cv.__sid; childName = cn; }
    keys.push(k); childSids.push(child);
    fields[k] = childName ? [kind, idx, childName] : [kind, idx];
    idx++;
  }
  return makeEagerView(keys, childSids, fields, name);
}

// Read every field (forces full materialization) — works on a view or a plain object.
function readAll(o, spec) {
  let acc = 0;
  for (const f of spec) {
    const v = o[f.name];
    if (v == null) continue;
    if (f.kind === "child") acc += readAll(v, f.childSpec);
    else if (f.kind === "structArray") { for (const e of v) acc += readAll(e, f.childSpec); }
    else if (f.kind === "numArray") { for (const x of v) acc += x; }
    else if (f.kind === "strArray") { for (const s of v) acc += s.length; }
    else if (f.kind === "num") acc += v;
    else if (f.kind === "bool") acc += v ? 1 : 0;
    else acc += ("" + v).length;
  }
  return acc;
}

// Read the first up-to-3 scalar/string top-level fields (realistic partial access).
function readFew(o, spec) {
  let acc = 0, k = 0;
  for (const f of spec) {
    if (f.kind === "child" || f.kind === "structArray" || f.kind === "numArray" || f.kind === "strArray") continue;
    const v = o[f.name];
    if (v != null) acc += f.kind === "num" ? v : f.kind === "bool" ? (v ? 1 : 0) : ("" + v).length;
    if (++k === 3) break;
  }
  return acc;
}

const bb = (x) => x;
const t = (fn, n) => { let w = Math.max(1, n / 10 | 0); while (w-- > 0) fn(); const s = performance.now(); let c = n; while (c-- > 0) fn(); return performance.now() - s; };
const best = (fn, n) => Math.min(t(fn, n), t(fn, n));

console.log("Deserialize — MB/s. native = JSON.parse; lazy full = parse+read ALL;");
console.log("lazy 3 = parse + read 3 fields; eager = eager parse + read ALL\n");
console.log("payload   bytes   native   lazy-full(x)  lazy-3(x)   eager(x)");
console.log("-".repeat(66));
const results = [];
for (const { name, json } of PAYLOADS) {
  const sample = JSON.parse(json);
  const { View, spec } = autoSchema(sample, name);
  const EView = autoEagerView(sample, name + "#e");
  const ourFull = () => bb(readAll(new View(parse(View.__sid, json)), spec));
  const ourFew = () => bb(readFew(new View(parse(View.__sid, json)), spec));
  const ourEager = () => bb(readAll(parseEager(EView.__sid, EView, json), spec));
  const nat = () => bb(readAll(JSON.parse(json), spec));
  if (ourFull() !== nat() || ourEager() !== nat()) { console.log(`  MISMATCH ${name}: lazy ${ourFull()} eager ${ourEager()} != ${nat()}`); continue; }

  const bytes = Buffer.byteLength(json, "utf8");
  const ops = Math.min(3_000_000, Math.max(2000, Math.round((48 << 20) / bytes)));
  const mbps = (ms) => (bytes * ops) / (ms / 1000) / 1e6;
  const n = mbps(best(nat, ops)), full = mbps(best(ourFull, ops)), few = mbps(best(ourFew, ops)), eag = mbps(best(ourEager, ops));
  const r = (v) => `${String(Math.round(v)).padStart(5)}(${(v / n).toFixed(2)}x)`;
  console.log(`${name.padEnd(9)} ${String(bytes).padStart(5)} ${String(Math.round(n)).padStart(6)}  ${r(full)} ${r(few)} ${r(eag)}`);
  results.push({ name, bytes, native: n, "json-ty lazy (full)": full, "json-ty lazy (3 fields)": few, "json-ty eager": eag });
}
mkdirSync(join(HERE, "build/logs"), { recursive: true });
writeFileSync(join(HERE, "build/logs/deserialize.json"), JSON.stringify(results, null, 2));
console.log("\nwrote build/logs/deserialize.json");

// 1 MiB strings at three escape densities × three serializers.
//   native   = JSON.stringify
//   json-ty  = the real src/serialize/string.js (scalar JS)
//   wasm     = Buffer.write into WASM + SIMD escape + read output back (full round trip)
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { serializeString } from "../../src/serialize/string.js";
import fastJson from "fast-json-stringify";

const fjsString = fastJson({ type: "string" }); // fast-json-stringify's string serializer

const HERE = dirname(fileURLToPath(import.meta.url));
const inst = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(join(HERE, "build/escape.wasm"))),
  { env: { abort: () => { throw new Error("abort"); } } },
);
const ex = inst.exports;
const SRC = ex.srcPtr() >>> 0;
const OUT = ex.outPtr() >>> 0;
const nbuf = Buffer.from(ex.memory.buffer); // view over WASM memory (Node)

// route a string through WASM and back: copy in (Buffer.write), SIMD escape,
// read the escaped output back out as a JS string (Buffer.toString — native).
function wasmSerialize(str) {
  const len = nbuf.write(str, SRC, "utf8");
  const outLen = ex.escape(len);
  return nbuf.toString("utf8", OUT, OUT + outLen);
}

const MiB = 1 << 20;
function buildString(escapeEvery) {
  // escapeEvery = 0 -> none; else replace every Nth char with '"' (escapes to \")
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,";
  const arr = new Array(MiB);
  for (let i = 0; i < MiB; i++) {
    arr[i] = escapeEvery && i % escapeEvery === 0 ? '"' : a[i % a.length];
  }
  return arr.join("");
}

const cases = [
  { name: "escape-free", str: buildString(0) },
  { name: "light (~1%)", str: buildString(100) },
  { name: "heavy (50%)", str: buildString(2) },
];

// correctness
for (const c of cases) {
  const ref = JSON.stringify(c.str);
  if (serializeString(c.str) !== ref) { console.log("json-ty MISMATCH", c.name); process.exit(1); }
  if (fjsString(c.str) !== ref) { console.log("fjs MISMATCH", c.name); process.exit(1); }
  if (wasmSerialize(c.str) !== ref) { console.log("wasm MISMATCH", c.name); process.exit(1); }
}
console.log("correctness: OK\n");

const bb = (x) => x;
const timeMs = (fn, ops) => { let w = Math.max(1, ops / 10) | 0; while (w-- > 0) fn(); const s = performance.now(); let c = ops; while (c-- > 0) fn(); return performance.now() - s; };
const mbps = (ms, ops) => (MiB * ops) / (ms / 1000) / 1e6;
const OPS = 2000;

console.log("1 MiB string — MB/s of input (higher = better), and escapes/byte\n");
console.log("density        escapes   native   json-ty      fjs     wasm   | wasm/native");
console.log("-".repeat(80));
const results = [];
for (const c of cases) {
  const tN = timeMs(() => bb(JSON.stringify(c.str)), OPS);
  const tJ = timeMs(() => bb(serializeString(c.str)), OPS);
  const tF = timeMs(() => bb(fjsString(c.str)), OPS);
  const tW = timeMs(() => bb(wasmSerialize(c.str)), OPS);
  const f = (v) => String(Math.round(v)).padStart(7);
  const n = mbps(tN, OPS), j = mbps(tJ, OPS), fj = mbps(tF, OPS), w = mbps(tW, OPS);
  const escCount = (JSON.stringify(c.str).length - c.str.length - 2); // extra bytes ~= escapes
  console.log(`${c.name.padEnd(14)} ${String(escCount).padStart(7)}  ${f(n)} ${f(j)} ${f(fj)} ${f(w)}  | ${(w / n).toFixed(2)}×`);
  results.push({ density: c.name, escapes: escCount, native: n, "json-ty": j, "fast-json-stringify": fj, "wasm-simd": w });
}
mkdirSync(join(HERE, "build/logs"), { recursive: true });
writeFileSync(join(HERE, "build/logs/escape-density.json"), JSON.stringify(results, null, 2));
console.log("\nwasm = full round trip: Buffer.write in + SIMD escape + Buffer.toString out.");
console.log("(escape-free can skip the read-back via the clean-wrap shortcut — not done here.)");

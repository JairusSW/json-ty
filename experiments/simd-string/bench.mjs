// SIMD JSON-string serializer vs native JSON.stringify.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const inst = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(join(HERE, "build/escape.wasm"))),
  { env: { abort: () => { throw new Error("abort"); } } },
);
const ex = inst.exports;
const SRC = ex.srcPtr() >>> 0;
const u8 = new Uint8Array(ex.memory.buffer);
const u16 = new Uint16Array(ex.memory.buffer);
const SRC16 = SRC >>> 1; // SRC is 16-byte aligned, so u16-addressable
const srcView = u8.subarray(SRC, SRC + (4 << 20));
const enc = new TextEncoder();

function writeUtf8(str) {
  const n = str.length;
  for (let i = 0; i < n; i++) {
    const c = str.charCodeAt(i);
    if (c > 0x7f) return enc.encodeInto(str, srcView).written;
    u8[SRC + i] = c;
  }
  return n;
}

// json-ty's scalar JS string serializer (current src/serialize/string.js logic)
const ESCAPE_TABLE = ["\\u0000","\\u0001","\\u0002","\\u0003","\\u0004","\\u0005","\\u0006","\\u0007","\\b","\\t","\\n","\\u000b","\\f","\\r","\\u000e","\\u000f","\\u0010","\\u0011","\\u0012","\\u0013","\\u0014","\\u0015","\\u0016","\\u0017","\\u0018","\\u0019","\\u001a","\\u001b","\\u001c","\\u001d","\\u001e","\\u001f"," ","!",'\\"'];
function serializeScalar(data) {
  const len = data.length;
  let result = '"', last = 0, ch = 0;
  for (let i = 0; i < len; i++) {
    ch = data.charCodeAt(i);
    if (ch < 35 || ch === 92) { result += data.slice(last, i) + ESCAPE_TABLE[ch]; last = i + 1; }
  }
  return (last === 0 && '"' + data + '"') || result + data.slice(last) + '"';
}

// SIMD serializer: write bytes, SIMD-scan; clean -> wrap original (no read-out).
function serializeSimd(str) {
  const len = writeUtf8(str);
  const esc = ex.firstEscape(len);
  if (esc === len) return '"' + str + '"';
  return JSON.stringify(str); // MVP: rare dirty path falls back
}

// Same, but always use encodeInto (bulk, native) for the copy-in — better for
// large strings than the per-char loop.
function serializeSimdBulk(str) {
  const len = enc.encodeInto(str, srcView).written;
  const esc = ex.firstEscape(len);
  if (esc === len) return '"' + str + '"';
  return JSON.stringify(str);
}

// UTF-16 path: charCodeAt straight into a Uint16Array (no UTF-8 transcode),
// SIMD-scan u16 units. Skips utf-as/encodeInto entirely.
function serializeSimd16(str) {
  const n = str.length;
  for (let i = 0; i < n; i++) u16[SRC16 + i] = str.charCodeAt(i);
  const esc = ex.firstEscape16(n);
  if (esc === n) return '"' + str + '"';
  return JSON.stringify(str);
}

// UTF-16 path with a bulk native copy (Node-only): Buffer.from(str,'utf16le').
function serializeSimd16Bulk(str) {
  const buf = Buffer.from(str, "utf16le"); // native bulk UTF-16 extract
  u8.set(buf, SRC);
  const esc = ex.firstEscape16(str.length);
  if (esc === str.length) return '"' + str + '"';
  return JSON.stringify(str);
}

const bb = (x) => x;
function timeMs(fn, ops) { let w = ops / 10; while (w-- > 0) fn(); const s = performance.now(); let c = ops; while (c-- > 0) fn(); return performance.now() - s; }
const mbps = (bytes, ops, ms) => (bytes * ops) / (ms / 1000) / 1e6;

function makeClean(n) { const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,"; let s = ""; while (s.length < n) s += a; return s.slice(0, n); }

const SIZES = [16, 64, 256, 1024, 16384, 262144, 1 << 20];
console.log("clean ASCII strings — MB/s (string bytes / s), higher = better\n");
console.log("size      native   scalar(JS) simd-u8bulk  simd-u16  u16-bulk  scan-only");
console.log("-".repeat(80));

for (const n of SIZES) {
  const str = makeClean(n);
  // sanity: all agree with native
  if (serializeScalar(str) !== JSON.stringify(str) || serializeSimdBulk(str) !== JSON.stringify(str) ||
      serializeSimd16(str) !== JSON.stringify(str) || serializeSimd16Bulk(str) !== JSON.stringify(str)) {
    console.log(`  MISMATCH at ${n}`); continue;
  }
  const ops = Math.min(2_000_000, Math.max(200, Math.round((24 << 20) / n)));

  const tNative = timeMs(() => bb(JSON.stringify(str)), ops);
  const tScalar = timeMs(() => bb(serializeScalar(str)), ops);
  const tBulk = timeMs(() => bb(serializeSimdBulk(str)), ops);
  const t16 = timeMs(() => bb(serializeSimd16(str)), ops);
  const t16b = timeMs(() => bb(serializeSimd16Bulk(str)), ops);
  writeUtf8(str); // prime SRC with UTF-8 for the u8 scan-only ceiling
  const tScan = timeMs(() => bb(ex.firstEscape(n)), ops); // bytes already resident

  const f = (v) => String(Math.round(v)).padStart(9);
  const label = n >= 1024 ? `${n >> 10}K` : `${n}B`;
  console.log(`${label.padEnd(8)} ${f(mbps(n, ops, tNative))} ${f(mbps(n, ops, tScalar))} ${f(mbps(n, ops, tBulk))} ${f(mbps(n, ops, t16))} ${f(mbps(n, ops, t16b))} ${f(mbps(n, ops, tScan))}`);
}

console.log("\nnative/scalar = JSON string serialize from a JS string (pure JS).");
console.log("simd-u8bulk   = encodeInto (UTF-8, native bulk) + u8 SIMD scan + wrap.");
console.log("simd-u16      = charCodeAt -> Uint16Array (per-char JS loop) + u16 SIMD scan.");
console.log("u16-bulk      = Buffer.from(str,'utf16le') (native bulk, Node-only) + u16 SIMD scan.");
console.log("scan-only     = SIMD scan of bytes ALREADY resident in WASM (the ceiling).");

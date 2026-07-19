// Node-tuned SIMD string serializer. Uses Buffer (Node-only) for the copy-in:
// a Buffer view over WASM memory lets buf.write(str, offset, enc) transcode
// straight into linear memory with zero allocation. (Generic/portable version
// will fall back to encodeInto.)
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
const srcView = u8.subarray(SRC, SRC + (4 << 20));
const enc = new TextEncoder();
// Buffer view over the SAME linear memory — no copy; write() targets offset SRC.
const nbuf = Buffer.from(ex.memory.buffer);

// --- copy-in strategies (string -> UTF-8 bytes at SRC, return byte length) ---
const copyEncodeInto = (str) => enc.encodeInto(str, srcView).written;
const copyBufUtf8 = (str) => nbuf.write(str, SRC, "utf8");
const copyBufLatin1 = (str) => nbuf.write(str, SRC, "latin1"); // ASCII-only fast path

function serialize(copy) {
  return (str) => {
    const len = copy(str);
    return ex.firstEscape(len) === len ? '"' + str + '"' : JSON.stringify(str);
  };
}
const sEncodeInto = serialize(copyEncodeInto);
const sBufUtf8 = serialize(copyBufUtf8);
const sBufLatin1 = serialize(copyBufLatin1);

const bb = (x) => x;
const timeMs = (fn, ops) => { let w = ops / 10; while (w-- > 0) fn(); const s = performance.now(); let c = ops; while (c-- > 0) fn(); return performance.now() - s; };
const mbps = (bytes, ops, ms) => (bytes * ops) / (ms / 1000) / 1e6;
const makeClean = (n) => { const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,"; let s = ""; while (s.length < n) s += a; return s.slice(0, n); };

// correctness — clean ASCII of various lengths, plus unicode and escape cases.
// (bufLatin1 is ASCII-only by design, so it's only checked on ASCII inputs.)
const asciiCases = [0, 1, 15, 17, 64, 1000].map(makeClean);
for (const str of asciiCases) {
  for (const s of [sEncodeInto, sBufUtf8, sBufLatin1]) {
    if (s(str) !== JSON.stringify(str)) { console.log("MISMATCH ascii", str.length); process.exit(1); }
  }
}
const unicodeEscapeCases = ['café €17 😀', 'tab\tnewline\n', 'quote " and back \\ slash', '日本語テキスト'];
for (const str of unicodeEscapeCases) {
  for (const s of [sEncodeInto, sBufUtf8]) { // utf8 paths only
    if (s(str) !== JSON.stringify(str)) { console.log("MISMATCH", JSON.stringify(str), "=>", s(str)); process.exit(1); }
  }
}
console.log("correctness: OK (ascii + unicode + escapes)\n");

console.log("clean ASCII — MB/s (higher = better)\n");
console.log("size      native   encodeInto  bufUtf8   bufLatin1  | copy: encInto  bufUtf8  bufLat1");
console.log("-".repeat(90));
for (const n of [16, 64, 256, 1024, 16384, 262144, 1 << 20]) {
  const str = makeClean(n);
  const ops = Math.min(2_000_000, Math.max(200, Math.round((24 << 20) / n)));
  const f = (v) => String(Math.round(v)).padStart(8);

  const tNative = timeMs(() => bb(JSON.stringify(str)), ops);
  const tEnc = timeMs(() => bb(sEncodeInto(str)), ops);
  const tBuf = timeMs(() => bb(sBufUtf8(str)), ops);
  const tLat = timeMs(() => bb(sBufLatin1(str)), ops);
  // copy-in alone
  const cEnc = timeMs(() => bb(copyEncodeInto(str)), ops);
  const cBuf = timeMs(() => bb(copyBufUtf8(str)), ops);
  const cLat = timeMs(() => bb(copyBufLatin1(str)), ops);

  const label = n >= 1024 ? `${n >> 10}K` : `${n}B`;
  console.log(`${label.padEnd(8)} ${f(mbps(n, ops, tNative))} ${f(mbps(n, ops, tEnc))} ${f(mbps(n, ops, tBuf))} ${f(mbps(n, ops, tLat))}  | ${f(mbps(n, ops, cEnc))} ${f(mbps(n, ops, cBuf))} ${f(mbps(n, ops, cLat))}`);
}
console.log("\nbufLatin1 is ASCII-only (mangles >=0x80) — would need an ASCII guard in the real path.");

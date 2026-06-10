// JS <-> WASM string-boundary throughput.
//
// Measures the ceiling on a "serialize in WASM" design: the cost of moving
// string bytes across the boundary and transcoding UTF-16<->UTF-8 (via utf-as).
// Run: node experiments/string-bridge/bench.mjs
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM = readFileSync(join(HERE, "build/bridge.wasm"));
const module = new WebAssembly.Module(WASM);

const enc = new TextEncoder();
const dec = new TextDecoder();

// Re-instantiate per payload so the stub bump-allocator's heap resets (it never
// frees). Then pre-grow memory so ingest's allocations never trigger a grow
// mid-loop, which would detach our Uint8Array view.
function fresh(reserveBytes) {
  const instance = new WebAssembly.Instance(module, {
    env: { abort: () => { throw new Error("wasm abort"); }, seed: () => 0 },
  });
  const ex = instance.exports;
  const mem = ex.memory;
  while (mem.buffer.byteLength < reserveBytes) mem.grow(1024);
  return { ex, u8: new Uint8Array(mem.buffer), ptr: ex.bufPtr() >>> 0 };
}

function mbps(bytes, ms) {
  return bytes / (ms / 1000) / 1e6;
}

function time(fn, iters) {
  let w = Math.max(1, iters / 10) | 0;
  while (w-- > 0) fn();
  const s = performance.now();
  let c = iters;
  while (c-- > 0) fn();
  return performance.now() - s;
}

function makeAscii(n) {
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,";
  let s = "";
  while (s.length < n) s += a;
  return s.slice(0, n);
}
function makeUnicode(n) {
  // mix of ASCII, 2-byte (é), 3-byte (€), 4-byte (😀) so UTF-8 != UTF-16 len
  const a = "abc é € 😀 def ";
  let s = "";
  while (s.length < n) s += a;
  return s.slice(0, n);
}

const SIZES = [
  { label: "16B", str: makeAscii(16) },
  { label: "64B", str: makeAscii(64) },
  { label: "256B", str: makeAscii(256) },
  { label: "1KB", str: makeAscii(1024) },
  { label: "16KB", str: makeAscii(16 << 10) },
  { label: "256KB", str: makeAscii(256 << 10) },
  { label: "1MB", str: makeAscii(1 << 20) },
  { label: "1KB·uni", str: makeUnicode(1024) },
];

const TARGET = 24 << 20; // bytes processed per measurement (bounds ingest alloc)
const RESERVE = 768 << 20; // pre-grow so ingest never grows memory mid-loop

const rows = [];
console.log(
  "payload  bytes    iters     |  send copy   send+valid  send+ingest |  recv emit   recv+read  |  js encode  js decode".replace(/ {2,}/g, (m) => m),
);
console.log("-".repeat(118));

for (const { label, str } of SIZES) {
  const bytes = enc.encode(str); // UTF-8
  const nbytes = bytes.length;
  const iters = Math.min(2_000_000, Math.max(200, Math.round(TARGET / nbytes)));

  let { ex, u8, ptr } = fresh(RESERVE);

  // send: raw copy only
  const tCopy = time(() => { u8.set(bytes, ptr); }, iters);
  // send: copy + SIMD validate (no alloc)
  const tValid = time(() => { u8.set(bytes, ptr); ex.validateUtf8(nbytes); }, iters);
  // send: copy + decode to AS string (full ingest, allocates)
  const tIngest = time(() => { u8.set(bytes, ptr); ex.ingestUtf8(nbytes); }, iters);

  // prime stored string for the send direction
  u8.set(bytes, ptr); ex.ingestUtf8(nbytes);
  // ingest may have grown memory; re-grab the view before reading bytes back
  u8 = new Uint8Array(ex.memory.buffer);
  // recv: wasm encodes stored -> UTF-8 in buf (no JS read)
  const tEmit = time(() => { ex.emitUtf8(); }, iters);
  // recv: encode + JS reads bytes back into a JS string
  const tRead = time(() => { const n = ex.emitUtf8(); dec.decode(u8.subarray(ptr, ptr + n)); }, iters);

  // pure-JS baselines
  const tJsEnc = time(() => { enc.encode(str); }, iters);
  const tJsDec = time(() => { dec.decode(bytes); }, iters);

  const r = {
    payload: label, bytes: nbytes, iters,
    sendCopy: mbps(nbytes * iters, tCopy),
    sendValidate: mbps(nbytes * iters, tValid),
    sendIngest: mbps(nbytes * iters, tIngest),
    recvEmit: mbps(nbytes * iters, tEmit),
    recvRead: mbps(nbytes * iters, tRead),
    jsEncode: mbps(nbytes * iters, tJsEnc),
    jsDecode: mbps(nbytes * iters, tJsDec),
  };
  rows.push(r);

  const f = (v) => String(Math.round(v)).padStart(9);
  console.log(
    `${label.padEnd(8)} ${String(nbytes).padStart(7)} ${String(iters).padStart(8)}  | ${f(r.sendCopy)} ${f(r.sendValidate)} ${f(r.sendIngest)} | ${f(r.recvEmit)} ${f(r.recvRead)} | ${f(r.jsEncode)} ${f(r.jsDecode)}`,
  );
}

console.log("\nAll numbers are MB/s (UTF-8 bytes moved / second). Higher = better.");
mkdirSync(join(HERE, "build/logs"), { recursive: true });
writeFileSync(join(HERE, "build/logs/string-bridge.json"), JSON.stringify(rows, null, 2));
console.log("wrote build/logs/string-bridge.json");

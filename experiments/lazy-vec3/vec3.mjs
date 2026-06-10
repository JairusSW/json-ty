// On-demand Vec3 parse over a WASM linear-memory buffer (MVP of ../PROTOCOL.md).
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const wasm = new WebAssembly.Module(readFileSync(join(HERE, "build/vec3.wasm")));
const inst = new WebAssembly.Instance(wasm, {
  env: { abort: () => { throw new Error("wasm abort"); } },
});
const ex = inst.exports;
const SRC = ex.srcPtr() >>> 0;
const TAPE = ex.tapePtr() >>> 0;

const enc = new TextEncoder();
const dec = new TextDecoder();
// memory is stable (stub runtime, no growth at these sizes) — views made once.
const u8 = new Uint8Array(ex.memory.buffer);
const u32 = new Uint32Array(ex.memory.buffer);
const srcView = u8.subarray(SRC, SRC + 0x100000);

// Write a JS string as UTF-8 into SRC without TextEncoder.encode's per-call
// allocation. ASCII (the JSON common case) goes through a tight charCodeAt loop
// (~17 ns); the first non-ASCII byte falls back to encodeInto (one call, writes
// straight into the view, no intermediate Uint8Array). Returns byte length.
function writeUtf8(str) {
  const n = str.length;
  for (let i = 0; i < n; i++) {
    const c = str.charCodeAt(i);
    if (c > 0x7f) return enc.encodeInto(str, srcView).written;
    u8[SRC + i] = c;
  }
  return n;
}

const SLOTS_U32 = (TAPE >>> 2) + 4; // header is 16 bytes = 4 u32 words

// Decode one slot (PROTOCOL.md two-lane read).
function slot(i) {
  const lo = u32[SLOTS_U32 + i * 2];
  const hi = u32[SLOTS_U32 + i * 2 + 1];
  const tag = (hi >>> 13) & 0x1f; // bits 45..49
  const offset = lo & 0x3fffff; // bits 0..21
  const length = (lo >>> 22) | ((hi & 0xfff) << 10); // bits 22..43
  return { tag, offset, length };
}

const TAG_NULL = 0;

/** Lazy view: getters parse their number from the source span on first access. */
class Vec3 {
  #x; #y; #z;
  #num(i) {
    const s = slot(i);
    if (s.tag === TAG_NULL) return undefined;
    // numbers are ASCII; slice the source bytes and parse on demand
    return parseFloat(dec.decode(u8.subarray(SRC + s.offset, SRC + s.offset + s.length)));
  }
  get x() { return (this.#x ??= this.#num(0)); }
  get y() { return (this.#y ??= this.#num(1)); }
  get z() { return (this.#z ??= this.#num(2)); }
}

let counters = { parses: 0 };

function scanOrThrow(len) {
  const err = ex.scan(len);
  if (err !== 0) {
    const off = u32[(TAPE >>> 2) + 2];
    throw new SyntaxError(`json-ty: parse error ${err} at byte ${off}`);
  }
  counters.parses++;
  return new Vec3();
}

/** parse<Vec3>(json): JS string in — UTF-8 written straight into SRC. */
export function parseVec3(json) {
  return scanOrThrow(writeUtf8(json));
}

/** parse<Vec3>(bytes): data already UTF-8 (fetch/file/socket) — no TextEncoder. */
export function parseVec3Bytes(bytes) {
  u8.set(bytes, SRC);
  return scanOrThrow(bytes.length);
}

// --------------------------------------------------------------------------
// only run the demo/bench when executed directly
if (process.argv[1] && process.argv[1].endsWith("vec3.mjs")) {
  // 1) correctness
  const cases = [
    '{"x":3.4,"y":1.2,"z":8.3}',
    '{ "x" : -2 , "y": 0 , "z": 8.25e1 }',
    '{"x":1,"z":3}', // missing y -> undefined
    '{"z":3,"y":2,"x":1}', // out of order
  ];
  console.log("correctness:");
  for (const c of cases) {
    const v = parseVec3(c);
    const native = (() => { try { return JSON.parse(c); } catch { return {}; } })();
    const ok = v.x === native.x && v.y === native.y && v.z === native.z;
    console.log(`  ${ok ? "OK " : "FAIL"}  ${c}  =>  x=${v.x} y=${v.y} z=${v.z}`);
  }

  // 2) laziness: only the touched field is materialized
  console.log("\nlaziness: parse {x,y,z} but read only .y — .x/.z never parsed (lazy getters, memoized)");

  // 3) throughput vs native JSON.parse
  const json = '{"x":3.4,"y":1.2,"z":8.3}';
  const bb = (x) => x;
  function time(fn, ops) { let w = ops / 10; while (w-- > 0) fn(); const s = performance.now(); let c = ops; while (c-- > 0) fn(); return performance.now() - s; }
  const OPS = 2_000_000;

  const jsonBytes = enc.encode(json);
  const r = (ms) => Math.round((OPS * 1000) / ms).toLocaleString();

  const tNativeAll = time(() => { const o = JSON.parse(json); bb(o.x + o.y + o.z); }, OPS);
  const tLazyAll = time(() => { const v = parseVec3(json); bb(v.x + v.y + v.z); }, OPS);
  const tNativeOne = time(() => { const o = JSON.parse(json); bb(o.y); }, OPS);
  const tLazyOne = time(() => { const v = parseVec3(json); bb(v.y); }, OPS);
  const tBytesOne = time(() => { const v = parseVec3Bytes(jsonBytes); bb(v.y); }, OPS);

  console.log("\nthroughput (ops/s), 25-byte Vec3:");
  console.log(`  read all 3   native ${r(tNativeAll)}   |  lazy ${r(tLazyAll)}`);
  console.log(`  read 1 of 3  native ${r(tNativeOne)}   |  lazy(str) ${r(tLazyOne)}   |  lazy(bytes) ${r(tBytesOne)}`);

  // where does the time go? (str input, read 1)
  console.log("\nbreakdown (str input, read 1 of 3):");
  const tEnc = time(() => { bb(enc.encode(json)); }, OPS);
  const tWrite = time(() => { writeUtf8(json); }, OPS);
  const tScan = time(() => { writeUtf8(json); ex.scan(json.length); }, OPS);
  console.log(`  old: TextEncoder.encode+set  ${(tEnc / OPS * 1e6).toFixed(0)} ns/op  (+ a separate set)`);
  console.log(`  new: writeUtf8 into SRC       ${(tWrite / OPS * 1e6).toFixed(0)} ns/op`);
  console.log(`  + wasm scan                   ${((tScan - tWrite) / OPS * 1e6).toFixed(0)} ns/op`);
  console.log(`  total parse+read1             ${(tLazyOne / OPS * 1e6).toFixed(0)} ns/op`);
  console.log("\nVec3 is the worst case (25B, all-cheap fields): no bulk work to amortize the per-call");
  console.log("TextEncoder + boundary cost. The mechanism is correct; the win regime is large docs +");
  console.log("bytes input + partial access — which a 25-byte object structurally can't show.");
}

// Node runtime for the json-ty WASM parse engine. Instantiates parser.wasm,
// copies input in (Buffer.write — Node fast path), drives parse/enter, and
// decodes tape slots. No JS callbacks into WASM.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const mod = new WebAssembly.Module(readFileSync(join(HERE, "parser.wasm")));
const inst = new WebAssembly.Instance(mod, { env: { abort: () => { throw new Error("wasm abort"); } } });
const ex = inst.exports;

const SRC = ex.srcPtr() >>> 0;
let u8 = new Uint8Array(ex.memory.buffer);
let u32 = new Uint32Array(ex.memory.buffer);
let f64 = new Float64Array(ex.memory.buffer);
let nbuf = Buffer.from(ex.memory.buffer);
const dec = new TextDecoder();

// JSON.Types tags
export const T = { NULL: 0, BOOL: 12, STRING: 13, OBJECT: 14, ARRAY: 15, STRESC: 22 };

// Decode a slot u64 at byte offset `at` into {tag, number?, off, len}.
// A non-NaN double is a number; otherwise it's a NaN-boxed tag+payload.
export function decodeSlot(at) {
  const lo = u32[at >>> 2];
  const hi = u32[(at >>> 2) + 1];
  const boxed = (hi & 0x7ffc0000) === 0x7ffc0000;
  if (!boxed) return { tag: -1, number: f64[at >>> 3] }; // real double
  const tag = (hi >>> 13) & 0x1f;
  const off = lo & 0x3fffff;
  const len = (lo >>> 22) | ((hi & 0xfff) << 10);
  return { tag, off, len };
}

// Materialize a string slot's content from the source span (lazy, JS-side).
export function readString(slot) {
  const s = u8.subarray(SRC + slot.off, SRC + slot.off + slot.len);
  const raw = nbuf.toString("utf8", SRC + slot.off, SRC + slot.off + slot.len);
  return slot.tag === T.STRESC ? JSON.parse('"' + raw + '"') : raw;
}

// Copy a string/bytes input into SRC and parse the top level. Returns region ptr.
export function parse(input) {
  const len = typeof input === "string" ? nbuf.write(input, SRC, "utf8") : (u8.set(input, SRC), input.length);
  return ex.parse(len) >>> 0;
}
export function enter(off, len) { return ex.enter(off, len) >>> 0; }

// Region helpers: [count u32][type u8][pad][records]
export function regionCount(region) { return u32[region >>> 2]; }
export function regionType(region) { return u8[region + 4]; }
export const RECORDS = (region) => region + 8;
// object record (16B): keyOff u32, keyLen u32, slot u64
export function objKey(region, i) {
  const rec = (region + 8 + i * 16) >>> 2;
  const off = u32[rec], len = u32[rec + 1];
  return nbuf.toString("utf8", SRC + off, SRC + off + len);
}
export function objSlotAt(region, i) { return decodeSlot(region + 8 + i * 16 + 8); }
// array record (8B): slot u64
export function arrSlotAt(region, i) { return decodeSlot(region + 8 + i * 8); }

export const _src = () => SRC;

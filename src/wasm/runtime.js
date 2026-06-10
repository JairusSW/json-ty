// Node runtime for the schema-directed WASM parse engine. Schemas are
// registered once (field list -> fixed slot indices); parse scatters values
// into those slots, so field access is O(1) array indexing — no keys in output.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const mod = new WebAssembly.Module(readFileSync(join(HERE, "parser.wasm")));
const inst = new WebAssembly.Instance(mod, { env: { abort: () => { throw new Error("wasm abort"); } } });
const ex = inst.exports;

const SRC = ex.srcPtr() >>> 0;
const u8 = new Uint8Array(ex.memory.buffer);
const u32 = new Uint32Array(ex.memory.buffer);
const f64 = new Float64Array(ex.memory.buffer);
const dv = new DataView(ex.memory.buffer);
const nbuf = Buffer.from(ex.memory.buffer);

export const T = { NULL: 0, BOOL: 12, STRING: 13, OBJECT: 14, ARRAY: 15, STRESC: 22, ABSENT: 23 };

// Register a schema (array of JSON field names, in declaration order). The
// field's index == its slot index. Returns a schemaId. Call once per @json class.
export function registerSchema(keys) {
  let p = SRC;
  for (const k of keys) {
    const blen = Buffer.byteLength(k, "utf8");
    dv.setUint32(p, blen, true); // unaligned-safe length prefix
    nbuf.write(k, p + 4, "utf8");
    p += 4 + blen;
  }
  return ex.registerSchema(SRC, keys.length) | 0;
}

// pure-ASCII JS-string source ⇒ clean strings slice the original (O(1) cons).
let asciiSource = null;

export function decodeSlot(at) {
  const lo = u32[at >>> 2];
  const hi = u32[(at >>> 2) + 1];
  if ((hi & 0x7ffc0000) !== 0x7ffc0000) return { tag: -1, number: f64[at >>> 3] };
  const tag = (hi >>> 13) & 0x1f;
  const off = lo & 0x3fffff;
  const len = (lo >>> 22) | ((hi & 0xfff) << 10);
  return { tag, off, len };
}
export function slotAt(slotsPtr, i) { return decodeSlot(slotsPtr + i * 8); }

export function readString(slot) {
  if (asciiSource !== null) {
    const raw = asciiSource.slice(slot.off, slot.off + slot.len);
    return slot.tag === T.STRESC ? JSON.parse('"' + raw + '"') : raw;
  }
  const raw = nbuf.toString("utf8", SRC + slot.off, SRC + slot.off + slot.len);
  return slot.tag === T.STRESC ? JSON.parse('"' + raw + '"') : raw;
}

function writeInput(input) {
  if (typeof input === "string") {
    const len = nbuf.write(input, SRC, "utf8");
    asciiSource = len === input.length ? input : null;
    return len;
  }
  u8.set(input, SRC);
  asciiSource = null;
  return input.length;
}

export function parseObject(sid, input) { return ex.parseObject(sid, writeInput(input)) >>> 0; }
export function enterObject(sid, off, len) { return ex.enterObject(sid, off, len) >>> 0; }
export function enterArray(off, len) { return ex.enterArray(off, len) >>> 0; }
export function arrCount(region) { return u32[region >>> 2]; }
export function arrSlotAt(region, i) { return decodeSlot(region + 8 + i * 8); }

// Node runtime for the schema-tree engine. A schema's nested @json fields carry
// a childSid, so one parse() call walks the whole registered tree and links
// nested objects/arrays by pointer — JS then navigates with ZERO further calls.
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

export const T = { NULL: 0, BOOL: 12, STRING: 13, OBJECT: 14, ARRAY: 15, STRESC: 22, ABSENT: 23, OBJ_PTR: 24, ARR_PTR: 25 };
export const LEAF = -2, PRIM = -1; // childSid sentinels (scalar/string/lazy; primitive array)

// Register a schema. `keys` = field names (declaration order = slot index).
// `childSids[i]` = nested @json schemaId for object/struct-array fields, PRIM
// for number[]/string[], or LEAF (default) for scalars/strings/lazy.
export function registerSchema(keys, childSids = []) {
  let p = SRC;
  for (let f = 0; f < keys.length; f++) {
    const blen = Buffer.byteLength(keys[f], "utf8");
    dv.setUint32(p, blen, true);
    nbuf.write(keys[f], p + 4, "utf8");
    dv.setInt32(p + 4 + blen, childSids[f] ?? LEAF, true);
    p += 8 + blen;
  }
  return ex.registerSchema(SRC, keys.length) | 0;
}

let asciiSource = null;

export function decodeSlot(at) {
  const lo = u32[at >>> 2];
  const hi = u32[(at >>> 2) + 1];
  if ((hi & 0x7ffc0000) !== 0x7ffc0000) return { tag: -1, number: f64[at >>> 3] };
  const tag = (hi >>> 13) & 0x1f;
  return { tag, off: lo & 0x3fffff, len: (lo >>> 22) | ((hi & 0xfff) << 10), ptr: lo >>> 0 };
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
  u8.set(input, SRC); asciiSource = null; return input.length;
}

// ONE call each — the whole registered tree is parsed and linked.
export function parse(sid, input) { return ex.parse(sid, writeInput(input)) >>> 0; }
export function parseArrayOf(elemSid, input) { return ex.parseArrayOf(elemSid, writeInput(input)) >>> 0; }
export function parsePrimArray(input) { return ex.parsePrimArray(writeInput(input)) >>> 0; }

export function arrCount(region) { return u32[region >>> 2]; }
export function arrSlotAt(region, i) { return decodeSlot(region + 8 + i * 8); }

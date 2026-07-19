// JS reader for the pointer-linked eager flat tables. Each table is read via
// typed arrays; nested object/array fields hold a u32 pointer to a child table.
// Zero per-field allocation (besides materialized strings).
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const mod = new WebAssembly.Module(readFileSync(join(HERE, "build/eager.wasm")));
const inst = new WebAssembly.Instance(mod, { env: { abort: () => { throw new Error("wasm abort"); } } });
const ex = inst.exports;

const SRC = ex.srcPtr() >>> 0;
const u8 = new Uint8Array(ex.memory.buffer);
const u32 = new Uint32Array(ex.memory.buffer);
const f64 = new Float64Array(ex.memory.buffer);
const dv = new DataView(ex.memory.buffer);
const nbuf = Buffer.from(ex.memory.buffer);

export const LEAF = -2, PRIM = -1;
let asciiSource = null;

// keys + childSids (LEAF / PRIM / a child schemaId for nested object/struct-array)
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

function writeInput(input) {
  if (typeof input === "string") { const len = nbuf.write(input, SRC, "utf8"); asciiSource = len === input.length ? input : null; return len; }
  u8.set(input, SRC); asciiSource = null; return input.length;
}

function handle(region) {
  return { count: u32[region >>> 2], M: u32[(region >>> 2) + 1], f64base: (region + 8) >>> 3, u32base: (region + 8) >>> 2 };
}
export function parseObject(sid, input) { return handle(ex.parseEagerObject(sid, writeInput(input)) >>> 0); }
export function parseArray(sid, input) { return handle(ex.parseEagerArray(sid, writeInput(input)) >>> 0); }

// --- zero-alloc accessors (field kind known JS-side from the schema) ---
export function num(h, r, f) { return f64[h.f64base + r * h.M + f]; }
export function bool(h, r, f) { return f64[h.f64base + r * h.M + f] !== 0; }
export function str(h, r, f) {
  const i = h.u32base + (r * h.M + f) * 2;
  const off = u32[i], len = u32[i + 1];
  return asciiSource !== null ? asciiSource.slice(off, off + len) : nbuf.toString("utf8", SRC + off, SRC + off + len);
}
// nested object/array/prim field -> child table handle (follow the pointer)
export function child(h, r, f) { return handle(u32[h.u32base + (r * h.M + f) * 2]); }
export function sumColumn(h, f) { let acc = 0, b = h.f64base, M = h.M, n = h.count; for (let r = 0; r < n; r++) acc += f64[b + r * M + f]; return acc; }

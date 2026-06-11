// JS reader for the eager flat-record buffer. Reads scalars straight from a
// Float64Array and string spans from a Uint32Array — zero per-field allocation,
// no slot-decode object, no Map. Strings slice the original (ASCII) or decode.
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

let asciiSource = null;

export function registerSchema(keys) {
  let p = SRC;
  for (const k of keys) {
    const blen = Buffer.byteLength(k, "utf8");
    dv.setUint32(p, blen, true);
    nbuf.write(k, p + 4, "utf8");
    dv.setInt32(p + 4 + blen, -2, true); // childSid (ignored by eager parser)
    p += 8 + blen;
  }
  return ex.registerSchema(SRC, keys.length) | 0;
}

function writeInput(input) {
  if (typeof input === "string") {
    const len = nbuf.write(input, SRC, "utf8");
    asciiSource = len === input.length ? input : null;
    return len;
  }
  u8.set(input, SRC); asciiSource = null; return input.length;
}

// Parse a top-level array of flat objects. Returns a handle with direct views.
export function parseArray(sid, input) {
  const region = ex.parseEagerArray(sid, writeInput(input)) >>> 0;
  return handle(region);
}
export function parseObject(sid, input) {
  const region = ex.parseEagerObject(sid, writeInput(input)) >>> 0;
  return handle(region);
}
function handle(region) {
  const count = u32[region >>> 2];
  const M = u32[(region >>> 2) + 1];
  const dataPtr = region + 8;        // 8-aligned
  return { count, M, f64base: dataPtr >>> 3, u32base: dataPtr >>> 2 };
}

// --- zero-alloc accessors (field kind is known JS-side from the schema) ---
export function num(h, r, f) { return f64[h.f64base + r * h.M + f]; }
export function bool(h, r, f) { return f64[h.f64base + r * h.M + f] !== 0; }
export function str(h, r, f) {
  const i = (h.u32base + (r * h.M + f) * 2);
  const off = u32[i], len = u32[i + 1];
  if (asciiSource !== null) return asciiSource.slice(off, off + len);
  return nbuf.toString("utf8", SRC + off, SRC + off + len);
}
// Bulk: sum a numeric column with no object allocation.
export function sumColumn(h, f) {
  let acc = 0;
  const b = h.f64base, M = h.M, n = h.count;
  for (let r = 0; r < n; r++) acc += f64[b + r * M + f];
  return acc;
}

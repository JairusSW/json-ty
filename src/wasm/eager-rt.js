// Eager runtime: parse into flat pointer-linked tables, read via typed arrays.
// makeEagerView builds a view class whose getters read a record directly from
// the buffer (zero per-field allocation) and follow pointers into sub-tables.
// (Hand-written; eager.js next to it is asc's generated glue — unused.)
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const mod = new WebAssembly.Module(readFileSync(join(HERE, "eager.wasm")));
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

// table = [count u32][M u32] then count*M 8-byte slots
function readStrAt(j) {
  const off = u32[j], len = u32[j + 1];
  return asciiSource !== null ? asciiSource.slice(off, off + len) : nbuf.toString("utf8", SRC + off, SRC + off + len);
}

// Build an eager view class from the same {prop:[kind,idx,child?]} field spec
// the transform emits for the lazy makeView. The view caches its row base
// (f64/u32 indices) at construction, so getters are a single typed-array read.
const EVIEWS = {};
export function makeEagerView(keys, childSids, fields, name) {
  const sid = registerSchema(keys, childSids);
  class V {
    constructor(region, row = 0) {
      const M = u32[(region >>> 2) + 1];
      this._fb = ((region + 8) >>> 3) + row * M; // f64 base index of this row
      this._ub = ((region + 8) >>> 2) + row * M * 2; // u32 base index of this row
    }
  }
  V.__sid = sid;
  for (const prop in fields) {
    const [kind, i, child] = fields[prop];
    let get;
    switch (kind) {
      case "num": get = function () { return f64[this._fb + i]; }; break;
      case "bool": get = function () { return f64[this._fb + i] !== 0; }; break;
      case "str": get = function () { return readStrAt(this._ub + i * 2); }; break;
      case "child": get = function () { const p = u32[this._ub + i * 2]; return p ? new EVIEWS[child](p, 0) : null; }; break;
      case "structArray": get = function () { const p = u32[this._ub + i * 2], n = u32[p >>> 2], C = EVIEWS[child], o = new Array(n); for (let k = 0; k < n; k++) o[k] = new C(p, k); return o; }; break;
      case "numArray": get = function () { const p = u32[this._ub + i * 2], n = u32[p >>> 2], fb = (p + 8) >>> 3, o = new Array(n); for (let k = 0; k < n; k++) o[k] = f64[fb + k]; return o; }; break;
      case "strArray": get = function () { const p = u32[this._ub + i * 2], n = u32[p >>> 2], ub = (p + 8) >>> 2, o = new Array(n); for (let k = 0; k < n; k++) o[k] = readStrAt(ub + k * 2); return o; }; break;
      default: get = function () { return readStrAt(this._ub + i * 2); };
    }
    Object.defineProperty(V.prototype, prop, { get, enumerable: true });
  }
  EVIEWS[name] = V;
  return V;
}
const tcount = (region) => u32[region >>> 2];

// JSON.parse<T> (eager): one record table -> a view at row 0.
export function parseEager(sid, Ctor, input) { return new Ctor(ex.parseEagerObject(sid, writeInput(input)) >>> 0, 0); }
// JSON.parse<T[]> (eager): array table -> array of row views.
export function parseEagerArrViews(sid, Ctor, input) {
  const region = ex.parseEagerArray(sid, writeInput(input)) >>> 0, n = tcount(region), o = new Array(n);
  for (let k = 0; k < n; k++) o[k] = new Ctor(region, k);
  return o;
}

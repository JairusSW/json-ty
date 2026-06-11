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
const tcount = (region) => u32[region >>> 2];
const tM = (region) => u32[(region >>> 2) + 1];
function numAt(region, row, f) { return f64[((region + 8) >>> 3) + row * tM(region) + f]; }
function boolAt(region, row, f) { return f64[((region + 8) >>> 3) + row * tM(region) + f] !== 0; }
function ptrAt(region, row, f) { return u32[((region + 8) >>> 2) + (row * tM(region) + f) * 2]; }
function strAt(region, row, f) {
  const i = ((region + 8) >>> 2) + (row * tM(region) + f) * 2;
  const off = u32[i], len = u32[i + 1];
  return asciiSource !== null ? asciiSource.slice(off, off + len) : nbuf.toString("utf8", SRC + off, SRC + off + len);
}

// Build an eager view class from the same {prop:[kind,idx,child?]} field spec
// the transform emits for the lazy makeView.
const EVIEWS = {};
export function makeEagerView(keys, childSids, fields, name) {
  const sid = registerSchema(keys, childSids);
  class V { constructor(region, row = 0) { this._r = region; this._row = row; } }
  V.__sid = sid;
  for (const prop in fields) {
    const [kind, i, child] = fields[prop];
    let get;
    switch (kind) {
      case "num": get = function () { return numAt(this._r, this._row, i); }; break;
      case "bool": get = function () { return boolAt(this._r, this._row, i); }; break;
      case "str": get = function () { return strAt(this._r, this._row, i); }; break;
      case "child": get = function () { const p = ptrAt(this._r, this._row, i); return p ? new EVIEWS[child](p, 0) : null; }; break;
      case "structArray": get = function () { const p = ptrAt(this._r, this._row, i); const n = tcount(p), C = EVIEWS[child], o = new Array(n); for (let k = 0; k < n; k++) o[k] = new C(p, k); return o; }; break;
      case "numArray": get = function () { const p = ptrAt(this._r, this._row, i); const n = tcount(p), o = new Array(n); for (let k = 0; k < n; k++) o[k] = numAt(p, k, 0); return o; }; break;
      case "strArray": get = function () { const p = ptrAt(this._r, this._row, i); const n = tcount(p), o = new Array(n); for (let k = 0; k < n; k++) o[k] = strAt(p, k, 0); return o; }; break;
      default: get = function () { return strAt(this._r, this._row, i); };
    }
    Object.defineProperty(V.prototype, prop, { get, enumerable: true });
  }
  EVIEWS[name] = V;
  return V;
}

// JSON.parse<T> (eager): one record table -> a view at row 0.
export function parseEager(sid, Ctor, input) { return new Ctor(ex.parseEagerObject(sid, writeInput(input)) >>> 0, 0); }
// JSON.parse<T[]> (eager): array table -> array of row views.
export function parseEagerArrViews(sid, Ctor, input) {
  const region = ex.parseEagerArray(sid, writeInput(input)) >>> 0, n = tcount(region), o = new Array(n);
  for (let k = 0; k < n; k++) o[k] = new Ctor(region, k);
  return o;
}

// Lazy view base for the schema-tree engine. Nested objects/arrays are already
// parsed and linked by pointer during the single parse() call, so _child /
// _structArray wrap a pointer with NO further WASM call. Scalars eager, strings
// materialized on first access (memoized).
import { slotAt, decodeSlot, readString, arrCount, arrSlotAt, T } from "./runtime.js";

export class View {
  constructor(slotsPtr) { this._p = slotsPtr; this._memo = null; }
  _memoGet(i, make) {
    const memo = this._memo || (this._memo = new Map());
    if (memo.has(i)) return memo.get(i);
    const v = make(); memo.set(i, v); return v;
  }

  _num(i) { const s = slotAt(this._p, i); return s.tag === -1 ? s.number : undefined; }
  _bool(i) { const s = slotAt(this._p, i); return s.tag === T.BOOL ? (s.off & 1) === 1 : undefined; }
  _str(i) {
    const s = slotAt(this._p, i);
    if (s.tag === T.STRING || s.tag === T.STRESC) return this._memoGet(i, () => readString(s));
    return s.tag === T.NULL ? null : undefined;
  }
  // nested @json struct — slot is an OBJ_PTR to the already-parsed child slots
  _child(i, Ctor) {
    const s = slotAt(this._p, i);
    if (s.tag === T.NULL) return null;
    if (s.tag !== T.OBJ_PTR) return undefined;
    return this._memoGet(i, () => new Ctor(s.ptr));
  }
  _numArray(i) {
    const s = slotAt(this._p, i);
    if (s.tag === T.NULL) return null;
    if (s.tag !== T.ARR_PTR) return undefined;
    return this._memoGet(i, () => {
      const r = s.ptr, n = arrCount(r), out = new Array(n);
      for (let k = 0; k < n; k++) out[k] = arrSlotAt(r, k).number;
      return out;
    });
  }
  _strArray(i) {
    const s = slotAt(this._p, i);
    if (s.tag === T.NULL) return null;
    if (s.tag !== T.ARR_PTR) return undefined;
    return this._memoGet(i, () => {
      const r = s.ptr, n = arrCount(r), out = new Array(n);
      for (let k = 0; k < n; k++) out[k] = readString(arrSlotAt(r, k));
      return out;
    });
  }
  // array of @json structs — each element slot is an OBJ_PTR child
  _structArray(i, Ctor) {
    const s = slotAt(this._p, i);
    if (s.tag === T.NULL) return null;
    if (s.tag !== T.ARR_PTR) return undefined;
    return this._memoGet(i, () => {
      const r = s.ptr, n = arrCount(r), out = new Array(n);
      for (let k = 0; k < n; k++) out[k] = new Ctor(arrSlotAt(r, k).ptr);
      return out;
    });
  }
}

// Lazy view base for the schema-directed engine. A view wraps a fixed slot
// array (one slot per schema field). Getters address fields by their
// compile-time index — slotAt(slotsPtr, i) — so every lookup is O(1).
// Scalars are eager (read straight from the slot); strings and nested views
// materialize on first access, memoized.
import { slotAt, readString, enterObject, enterArray, arrCount, arrSlotAt, T } from "./runtime.js";

export class View {
  constructor(slotsPtr) {
    this._p = slotsPtr;
    this._memo = null;
  }
  _memoGet(i, make) {
    const memo = this._memo || (this._memo = new Map());
    if (memo.has(i)) return memo.get(i);
    const v = make();
    memo.set(i, v);
    return v;
  }

  // --- O(1) typed accessors (generated getters pass a constant index) ---
  _num(i) { const s = slotAt(this._p, i); return s.tag === -1 ? s.number : undefined; }
  _bool(i) { const s = slotAt(this._p, i); return s.tag === T.BOOL ? (s.off & 1) === 1 : undefined; }
  _str(i) {
    const s = slotAt(this._p, i);
    if (s.tag === T.STRING || s.tag === T.STRESC) return this._memoGet(i, () => readString(s));
    return s.tag === T.NULL ? null : undefined;
  }
  _child(i, sid, Ctor) {
    const s = slotAt(this._p, i);
    if (s.tag === T.NULL) return null;
    if (s.tag !== T.OBJECT) return undefined;
    return this._memoGet(i, () => new Ctor(enterObject(sid, s.off, s.len)));
  }
  _numArray(i) {
    const s = slotAt(this._p, i);
    if (s.tag !== T.ARRAY) return s.tag === T.NULL ? null : undefined;
    return this._memoGet(i, () => {
      const r = enterArray(s.off, s.len), n = arrCount(r), out = new Array(n);
      for (let k = 0; k < n; k++) out[k] = arrSlotAt(r, k).number;
      return out;
    });
  }
  _strArray(i) {
    const s = slotAt(this._p, i);
    if (s.tag !== T.ARRAY) return s.tag === T.NULL ? null : undefined;
    return this._memoGet(i, () => {
      const r = enterArray(s.off, s.len), n = arrCount(r), out = new Array(n);
      for (let k = 0; k < n; k++) out[k] = readString(arrSlotAt(r, k));
      return out;
    });
  }
  // array of @json structs: element k -> a child view (lazy)
  _structArray(i, sid, Ctor) {
    const s = slotAt(this._p, i);
    if (s.tag !== T.ARRAY) return s.tag === T.NULL ? null : undefined;
    return this._memoGet(i, () => {
      const r = enterArray(s.off, s.len), n = arrCount(r), out = new Array(n);
      for (let k = 0; k < n; k++) { const e = arrSlotAt(r, k); out[k] = new Ctor(enterObject(sid, e.off, e.len)); }
      return out;
    });
  }
}

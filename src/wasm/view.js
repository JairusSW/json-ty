// Lazy view base. Wraps a parsed tape region and exposes typed accessors the
// transform-generated subclasses call. Scalars read straight from the tape
// (eager-parsed in WASM); strings and nested views materialize on first access
// and are memoized.
import { regionCount, decodeSlot, readString, enter, objKeyOff, objKeyLen, keyEquals, T } from "./runtime.js";

export class View {
  constructor(region) {
    this._region = region;
    this._cache = null; // key -> resolved slot byte offset (or -1 if absent)
    this._memo = null;  // key -> materialized string/child/array
  }

  // Resolve key -> slot byte offset by allocation-free linear byte-compare
  // (objects are small; this is json-as's linear-scan strategy). Memoized.
  _slot(key) {
    const cache = this._cache || (this._cache = Object.create(null));
    let off = cache[key];
    if (off === undefined) {
      off = -1;
      const region = this._region, n = regionCount(region);
      for (let i = 0; i < n; i++) {
        const rec = region + 8 + i * 16;
        if (keyEquals(objKeyOff(rec), objKeyLen(rec), key)) { off = rec + 8; break; }
      }
      cache[key] = off;
    }
    return off === -1 ? null : decodeSlot(off);
  }
  _memoGet(key, make) {
    const memo = this._memo || (this._memo = Object.create(null));
    if (key in memo) return memo[key];
    return (memo[key] = make());
  }

  // --- typed accessors (generated getters call these) ---
  _num(key) { const s = this._slot(key); return s && s.tag === -1 ? s.number : undefined; }
  _bool(key) { const s = this._slot(key); return s && s.tag === T.BOOL ? (s.off & 1) === 1 : undefined; }
  _str(key) {
    const s = this._slot(key);
    if (!s || (s.tag !== T.STRING && s.tag !== T.STRESC)) return s && s.tag === T.NULL ? null : undefined;
    return this._memoGet(key, () => readString(s));
  }
  _child(key, Ctor) {
    const s = this._slot(key);
    if (!s) return undefined;
    if (s.tag === T.NULL) return null;
    if (s.tag !== T.OBJECT && s.tag !== T.ARRAY) return undefined;
    return this._memoGet(key, () => new Ctor(enter(s.off, s.len)));
  }
  // number[] / int[] — eager-materialize the array (v1)
  _numArray(key) {
    const s = this._slot(key);
    if (!s || s.tag !== T.ARRAY) return s && s.tag === T.NULL ? null : undefined;
    return this._memoGet(key, () => {
      const region = enter(s.off, s.len), n = regionCount(region), out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = decodeSlot(region + 8 + i * 8).number;
      return out;
    });
  }
  _strArray(key) {
    const s = this._slot(key);
    if (!s || s.tag !== T.ARRAY) return s && s.tag === T.NULL ? null : undefined;
    return this._memoGet(key, () => {
      const region = enter(s.off, s.len), n = regionCount(region), out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = readString(decodeSlot(region + 8 + i * 8));
      return out;
    });
  }
}

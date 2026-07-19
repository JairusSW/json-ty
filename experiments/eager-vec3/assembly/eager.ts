// Eager primitive parse: non-string primitives are parsed in AS and the actual
// value is handed back to JS (no lazy span, no JS-side parseFloat). Vec3 is all
// numbers, so AS parses x/y/z to f64 during the scan and writes them to a slot
// array JS reads directly. (Strings would stay lazy spans — not here.)
//
// Built --runtime stub. parseF64 uses the Clinger fast path (exact when the
// mantissa fits 2^53 and |exp| <= 22 — the common case incl. all our inputs).

export const CAP: i32 = 1 << 20;
const SRC = new StaticArray<u8>(CAP);
const SLOTS = new StaticArray<f64>(3); // x, y, z (NaN = absent)

export function srcPtr(): usize { return changetype<usize>(SRC); }
export function slotsPtr(): usize { return changetype<usize>(SLOTS); }

// 10^0 .. 10^22 — all exactly representable as f64.
const POW10: StaticArray<f64> = [
  1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11,
  1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
];

// @ts-ignore: inline
@inline function isDigit(c: u8): bool { return c >= 0x30 && c <= 0x39; }
// @ts-ignore: inline
@inline function isWs(b: u8): bool { return b == 0x20 || b == 0x09 || b == 0x0a || b == 0x0d; }

/** Parse the JSON number in SRC[p..end) to f64. */
function parseF64(p: usize, end: usize): f64 {
  let i = p;
  while (i < end && isWs(load<u8>(i))) i++;
  let neg = false;
  if (i < end && load<u8>(i) == 0x2d) { neg = true; i++; } // '-'
  let mant: u64 = 0;
  let fracDigits = 0;
  while (i < end && isDigit(load<u8>(i))) { mant = mant * 10 + <u64>(load<u8>(i) - 0x30); i++; }
  if (i < end && load<u8>(i) == 0x2e) { // '.'
    i++;
    while (i < end && isDigit(load<u8>(i))) { mant = mant * 10 + <u64>(load<u8>(i) - 0x30); fracDigits++; i++; }
  }
  let exp = 0, expNeg = false;
  if (i < end) {
    const c = load<u8>(i);
    if (c == 0x65 || c == 0x45) { // e / E
      i++;
      if (i < end) { const s = load<u8>(i); if (s == 0x2b) i++; else if (s == 0x2d) { expNeg = true; i++; } }
      while (i < end && isDigit(load<u8>(i))) { exp = exp * 10 + <i32>(load<u8>(i) - 0x30); i++; }
    }
  }
  if (expNeg) exp = -exp;
  const finalExp = exp - fracDigits;

  let result: f64;
  if (mant <= 9007199254740992 && finalExp >= -22 && finalExp <= 22) {
    const m = <f64>mant;
    result = finalExp >= 0 ? m * POW10[finalExp] : m / POW10[-finalExp];
  } else {
    result = <f64>mant * (10.0 ** <f64>finalExp); // rare fallback (may be ±1 ulp)
  }
  return neg ? -result : result;
}

const NaN64: f64 = NaN;

/** Eager-parse a Vec3 object in SRC[0..len). Returns errorCode. */
export function parseVec3(len: i32): i32 {
  const base = changetype<usize>(SRC);
  const slots = changetype<usize>(SLOTS);
  store<f64>(slots, NaN64);
  store<f64>(slots + 8, NaN64);
  store<f64>(slots + 16, NaN64);

  let i = 0;
  while (i < len && isWs(load<u8>(base + i))) i++;
  if (i >= len || load<u8>(base + i) != 0x7b) return 1; // '{'
  i++;
  while (i < len) {
    while (i < len && isWs(load<u8>(base + i))) i++;
    if (i < len && load<u8>(base + i) == 0x7d) break; // '}'
    if (i >= len || load<u8>(base + i) != 0x22) return 1; // '"'
    i++;
    const keyByte = load<u8>(base + i);
    while (i < len && load<u8>(base + i) != 0x22) i++;
    i++; // past closing quote
    let slot = -1;
    if (keyByte == 0x78) slot = 0; else if (keyByte == 0x79) slot = 1; else if (keyByte == 0x7a) slot = 2;
    while (i < len && isWs(load<u8>(base + i))) i++;
    if (i >= len || load<u8>(base + i) != 0x3a) return 1; // ':'
    i++;
    const valStart = i;
    while (i < len) { const b = load<u8>(base + i); if (b == 0x2c || b == 0x7d) break; i++; }
    if (slot >= 0) store<f64>(slots + (slot << 3), parseF64(base + valStart, base + i));
    while (i < len && isWs(load<u8>(base + i))) i++;
    if (i < len && load<u8>(base + i) == 0x2c) { i++; continue; }
    if (i < len && load<u8>(base + i) == 0x7d) break;
  }
  return 0;
}

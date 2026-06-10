// json-ty WASM parse engine — generic, one level at a time.
//
// parse(len) parses the top-level object/array in SRC into a tape region:
//   - scalars (number/bool/null) are parsed EAGERLY into the slot
//   - strings are recorded as spans (decoded lazily JS-side)
//   - nested objects/arrays are recorded as spans (entered lazily via enter())
// enter(off,len) parses one more level on demand. No JS callbacks; everything
// lives in linear memory. Built --runtime stub --enable simd --enable bulk-memory.

// ---- memory layout -------------------------------------------------------
const INPUT_CAP: i32 = 16 << 20; // 16 MiB source
const ARENA_CAP: i32 = 16 << 20; // 16 MiB tape arena
const SRC = new StaticArray<u8>(INPUT_CAP);
const ARENA = new StaticArray<u8>(ARENA_CAP);
let bump: usize = 0; // current arena offset (bytes from ARENA base)

export function srcPtr(): usize { return changetype<usize>(SRC); }
export function reserve(n: i32): usize { return changetype<usize>(SRC); } // v1: fixed cap
export function reset(): void { bump = 0; }

// ---- slot encoding (PROTOCOL.md) -----------------------------------------
const VAL_QNAN: u64 = 0x7ffc000000000000;
const TAG_SHIFT: u64 = 45;
const LZ_FIELD_MASK: u64 = 0x3fffff; // 22 bits
const LZ_ABS_FLAG: u64 = 0x100000000000; // bit 44
// JSON.Types tags
const T_NULL: u64 = 0, T_BOOL: u64 = 12, T_STRING: u64 = 13, T_OBJECT: u64 = 14, T_ARRAY: u64 = 15;
const T_STRESC: u64 = 22; // json-ty-internal: string that needs JSON unescaping

// @ts-ignore: inline
@inline function boxed(tag: u64, payload: u64): u64 { return VAL_QNAN | (tag << TAG_SHIFT) | (payload & 0x1fffffffffff); }
// @ts-ignore: inline
@inline function spanSlot(tag: u64, off: i32, len: i32): u64 {
  if (<u64>off <= LZ_FIELD_MASK && <u64>len <= LZ_FIELD_MASK) return boxed(tag, (<u64>len << 22) | <u64>off);
  return boxed(tag, LZ_ABS_FLAG | (<u64>off & 0xffffffff)); // absolute fallback (end scanned JS-side)
}

// ---- byte helpers --------------------------------------------------------
const QUOTE: u8 = 0x22, BACKSLASH: u8 = 0x5c, LBRACE: u8 = 0x7b, RBRACE: u8 = 0x7d;
const LBRACK: u8 = 0x5b, RBRACK: u8 = 0x5d, COLON: u8 = 0x3a, COMMA: u8 = 0x2c;

// @ts-ignore: inline
@inline function isWs(b: u8): bool { return b == 0x20 || b == 0x09 || b == 0x0a || b == 0x0d; }
// @ts-ignore: inline
@inline function isDigit(c: u8): bool { return c >= 0x30 && c <= 0x39; }

const POW10: StaticArray<f64> = [1e0,1e1,1e2,1e3,1e4,1e5,1e6,1e7,1e8,1e9,1e10,1e11,1e12,1e13,1e14,1e15,1e16,1e17,1e18,1e19,1e20,1e21,1e22];

// Parse the JSON number in SRC[p..end) to f64 (Clinger fast path).
function parseF64(p: usize, end: usize): f64 {
  let i = p;
  let neg = false;
  if (i < end && load<u8>(i) == 0x2d) { neg = true; i++; }
  let mant: u64 = 0, frac = 0;
  while (i < end && isDigit(load<u8>(i))) { mant = mant * 10 + <u64>(load<u8>(i) - 0x30); i++; }
  if (i < end && load<u8>(i) == 0x2e) { i++; while (i < end && isDigit(load<u8>(i))) { mant = mant * 10 + <u64>(load<u8>(i) - 0x30); frac++; i++; } }
  let exp = 0, eneg = false;
  if (i < end) { const c = load<u8>(i); if (c == 0x65 || c == 0x45) { i++; if (i < end) { const s = load<u8>(i); if (s == 0x2b) i++; else if (s == 0x2d) { eneg = true; i++; } } while (i < end && isDigit(load<u8>(i))) { exp = exp * 10 + <i32>(load<u8>(i) - 0x30); i++; } } }
  if (eneg) exp = -exp;
  const fe = exp - frac;
  let r: f64;
  if (mant <= 9007199254740992 && fe >= -22 && fe <= 22) { const m = <f64>mant; r = fe >= 0 ? m * POW10[fe] : m / POW10[-fe]; }
  else r = <f64>mant * (10.0 ** <f64>fe);
  return neg ? -r : r;
}

// SIMD-skip a string body from `start` (past opening quote) to its closing
// quote; returns the close offset. `escFlag` set to 1 if any backslash seen.
let lastEscaped: i32 = 0;
function skipString(start: i32, end: i32): i32 {
  const base = changetype<usize>(SRC);
  let k = start;
  lastEscaped = 0;
  for (;;) {
    while (k + 16 <= end) {
      const v = v128.load(base + k);
      const m = v128.or(i8x16.eq(v, i8x16.splat(QUOTE)), i8x16.eq(v, i8x16.splat(BACKSLASH)));
      if (v128.any_true(m)) break;
      k += 16;
    }
    while (k < end) {
      const c = load<u8>(base + k);
      if (c == BACKSLASH) { lastEscaped = 1; k += 2; break; }
      if (c == QUOTE) return k;
      k++;
    }
    if (k >= end) return k;
  }
  return k;
}

// Scan to the end of a composite value (object/array) starting at `p` (on the
// opening bracket); returns offset just past the matching close. String-aware.
function scanComposite(p: i32, end: i32): i32 {
  const base = changetype<usize>(SRC);
  let i = p, depth = 0;
  while (i < end) {
    const b = load<u8>(base + i);
    if (b == QUOTE) { i = skipString(i + 1, end) + 1; continue; }
    if (b == LBRACE || b == LBRACK) { depth++; i++; }
    else if (b == RBRACE || b == RBRACK) { depth--; i++; if (depth == 0) return i; }
    else i++;
  }
  return i;
}

// Parse the value at SRC[p..end). Writes its slot to `slotOut` (8 bytes) and
// returns the offset just past the value.
function parseValue(p: i32, end: i32, slotOut: usize): i32 {
  const base = changetype<usize>(SRC);
  let i = p;
  while (i < end && isWs(load<u8>(base + i))) i++;
  const b = load<u8>(base + i);
  if (b == QUOTE) {
    const cstart = i + 1;
    const cend = skipString(cstart, end);
    store<u64>(slotOut, spanSlot(lastEscaped ? T_STRESC : T_STRING, cstart, cend - cstart));
    return cend + 1;
  }
  if (b == LBRACE || b == LBRACK) {
    const vend = scanComposite(i, end);
    store<u64>(slotOut, spanSlot(b == LBRACE ? T_OBJECT : T_ARRAY, i, vend - i));
    return vend;
  }
  if (b == 0x74) { store<u64>(slotOut, boxed(T_BOOL, 1)); return i + 4; } // true
  if (b == 0x66) { store<u64>(slotOut, boxed(T_BOOL, 0)); return i + 5; } // false
  if (b == 0x6e) { store<u64>(slotOut, boxed(T_NULL, 0)); return i + 4; } // null
  // number: scan to delimiter, eager-parse to f64
  let ne = i;
  while (ne < end) { const c = load<u8>(base + ne); if (c == COMMA || c == RBRACE || c == RBRACK || isWs(c)) break; ne++; }
  store<f64>(slotOut, parseF64(base + i, base + ne));
  return ne;
}

// Parse one object/array level at SRC[p0..end) into a fresh arena region.
// Region: [count u32][type u8][pad u8 x3][records]. Object record = keyOff u32,
// keyLen u32, slot u64 (16B). Array record = slot u64 (8B). Returns region ptr.
function parseLevel(p0: i32, end: i32): usize {
  const base = changetype<usize>(SRC);
  const region = changetype<usize>(ARENA) + bump;
  let i = p0;
  while (i < end && isWs(load<u8>(base + i))) i++;
  const open = load<u8>(base + i);
  let count = 0;
  let rec = region + 8; // records start after the 8-byte region header

  if (open == LBRACE) {
    store<u8>(region + 4, <u8>T_OBJECT);
    i++;
    while (i < end) {
      while (i < end && isWs(load<u8>(base + i))) i++;
      if (load<u8>(base + i) == RBRACE) { i++; break; }
      if (load<u8>(base + i) != QUOTE) break; // malformed; stop
      const kstart = i + 1;
      const kend = skipString(kstart, end);
      store<u32>(rec, <u32>kstart);
      store<u32>(rec + 4, <u32>(kend - kstart));
      i = kend + 1;
      while (i < end && isWs(load<u8>(base + i))) i++;
      if (load<u8>(base + i) != COLON) break;
      i++;
      i = parseValue(i, end, rec + 8);
      rec += 16; count++;
      while (i < end && isWs(load<u8>(base + i))) i++;
      const sep = load<u8>(base + i);
      if (sep == COMMA) { i++; continue; }
      if (sep == RBRACE) { i++; break; }
      break;
    }
  } else if (open == LBRACK) {
    store<u8>(region + 4, <u8>T_ARRAY);
    i++;
    while (i < end) {
      while (i < end && isWs(load<u8>(base + i))) i++;
      if (load<u8>(base + i) == RBRACK) { i++; break; }
      i = parseValue(i, end, rec);
      rec += 8; count++;
      while (i < end && isWs(load<u8>(base + i))) i++;
      const sep = load<u8>(base + i);
      if (sep == COMMA) { i++; continue; }
      if (sep == RBRACK) { i++; break; }
      break;
    }
  } else {
    // bare scalar top-level
    store<u8>(region + 4, 0);
    parseValue(i, end, rec);
    rec += 8; count = 1;
  }

  store<u32>(region, <u32>count);
  bump = (rec - changetype<usize>(ARENA) + 7) & ~7; // advance bump, 8-byte aligned
  return region;
}

// ---- exports -------------------------------------------------------------
export function parse(len: i32): usize {
  bump = 0;
  return parseLevel(0, len);
}
export function enter(off: i32, len: i32): usize {
  return parseLevel(off, off + len);
}

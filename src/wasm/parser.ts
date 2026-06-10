// json-ty WASM parse engine — schema-directed, O(1) field access.
//
// A schema (the compile-time field list of an @json class) is registered once;
// the parser then scatters each object value into a FIXED slot indexed by the
// field's position. JS getters read slots[constIndex] directly — no key search,
// no keys in the output. Scalars eager; strings & nested objects/arrays are
// lazy spans. Built --runtime stub --enable simd --enable bulk-memory.

const INPUT_CAP: i32 = 16 << 20;
const ARENA_CAP: i32 = 16 << 20;
const SRC = new StaticArray<u8>(INPUT_CAP);
const ARENA = new StaticArray<u8>(ARENA_CAP);
let bump: usize = 0;
const SCRATCH = new StaticArray<u64>(1); // throwaway slot for unmatched keys

// ---- schema registry -----------------------------------------------------
const MAX_FIELDS: i32 = 4096;
const KEYS_CAP: i32 = 256 << 10;
const SCHEMA_KEYS = new StaticArray<u8>(KEYS_CAP);
const fieldKeyOff = new StaticArray<i32>(MAX_FIELDS); // offset into SCHEMA_KEYS
const fieldKeyLen = new StaticArray<i32>(MAX_FIELDS);
const schemaStart = new StaticArray<i32>(256); // first field index of schema
const schemaCount = new StaticArray<i32>(256); // field count of schema
let nSchemas = 0;
let keysBump = 0;
let fieldsBump = 0;

export function srcPtr(): usize { return changetype<usize>(SRC); }
export function reserve(n: i32): usize { return changetype<usize>(SRC); }
export function reset(): void { bump = 0; }

// Register a schema from a descriptor at `descPtr`: `count` entries, each
// [keyLen u32][key bytes]. Returns the schemaId. Call once per @json class.
export function registerSchema(descPtr: usize, count: i32): i32 {
  const sid = nSchemas++;
  schemaStart[sid] = fieldsBump;
  schemaCount[sid] = count;
  let p = descPtr;
  for (let f = 0; f < count; f++) {
    const klen = load<u32>(p); p += 4;
    const off = keysBump;
    memory.copy(changetype<usize>(SCHEMA_KEYS) + off, p, klen);
    fieldKeyOff[fieldsBump] = off;
    fieldKeyLen[fieldsBump] = <i32>klen;
    fieldsBump++;
    keysBump += <i32>klen;
    p += klen;
  }
  return sid;
}

// ---- slot encoding (PROTOCOL.md) -----------------------------------------
const VAL_QNAN: u64 = 0x7ffc000000000000;
const TAG_SHIFT: u64 = 45;
const LZ_MASK: u64 = 0x3fffff;
const LZ_ABS: u64 = 0x100000000000;
const T_NULL: u64 = 0, T_BOOL: u64 = 12, T_STRING: u64 = 13, T_OBJECT: u64 = 14, T_ARRAY: u64 = 15;
const T_STRESC: u64 = 22, T_ABSENT: u64 = 23;

// @ts-ignore
@inline function boxed(tag: u64, payload: u64): u64 { return VAL_QNAN | (tag << TAG_SHIFT) | (payload & 0x1fffffffffff); }
// @ts-ignore
@inline function spanSlot(tag: u64, off: i32, len: i32): u64 {
  if (<u64>off <= LZ_MASK && <u64>len <= LZ_MASK) return boxed(tag, (<u64>len << 22) | <u64>off);
  return boxed(tag, LZ_ABS | (<u64>off & 0xffffffff));
}
const ABSENT_SLOT: u64 = boxed(T_ABSENT, 0);

// ---- byte helpers --------------------------------------------------------
const QUOTE: u8 = 0x22, BACKSLASH: u8 = 0x5c, LBRACE: u8 = 0x7b, RBRACE: u8 = 0x7d;
const LBRACK: u8 = 0x5b, RBRACK: u8 = 0x5d, COLON: u8 = 0x3a, COMMA: u8 = 0x2c;
// @ts-ignore
@inline function isWs(b: u8): bool { return b == 0x20 || b == 0x09 || b == 0x0a || b == 0x0d; }
// @ts-ignore
@inline function isDigit(c: u8): bool { return c >= 0x30 && c <= 0x39; }

const POW10: StaticArray<f64> = [1e0,1e1,1e2,1e3,1e4,1e5,1e6,1e7,1e8,1e9,1e10,1e11,1e12,1e13,1e14,1e15,1e16,1e17,1e18,1e19,1e20,1e21,1e22];

function parseF64(p: usize, end: usize): f64 {
  let i = p; let neg = false;
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

let lastEscaped: i32 = 0;
function skipString(start: i32, end: i32): i32 {
  const base = changetype<usize>(SRC);
  let k = start; lastEscaped = 0;
  for (;;) {
    while (k + 16 <= end) {
      const v = v128.load(base + k);
      const m = v128.or(i8x16.eq(v, i8x16.splat(QUOTE)), i8x16.eq(v, i8x16.splat(BACKSLASH)));
      if (v128.any_true(m)) break;
      k += 16;
    }
    while (k < end) { const c = load<u8>(base + k); if (c == BACKSLASH) { lastEscaped = 1; k += 2; break; } if (c == QUOTE) return k; k++; }
    if (k >= end) return k;
  }
  return k;
}

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

// Parse the value at SRC[p..end), write its slot to `slotOut`, return value end.
function parseValue(p: i32, end: i32, slotOut: usize): i32 {
  const base = changetype<usize>(SRC);
  let i = p;
  while (i < end && isWs(load<u8>(base + i))) i++;
  const b = load<u8>(base + i);
  if (b == QUOTE) {
    const cs = i + 1, ce = skipString(cs, end);
    store<u64>(slotOut, spanSlot(lastEscaped ? T_STRESC : T_STRING, cs, ce - cs));
    return ce + 1;
  }
  if (b == LBRACE || b == LBRACK) {
    const ve = scanComposite(i, end);
    store<u64>(slotOut, spanSlot(b == LBRACE ? T_OBJECT : T_ARRAY, i, ve - i));
    return ve;
  }
  if (b == 0x74) { store<u64>(slotOut, boxed(T_BOOL, 1)); return i + 4; }
  if (b == 0x66) { store<u64>(slotOut, boxed(T_BOOL, 0)); return i + 5; }
  if (b == 0x6e) { store<u64>(slotOut, boxed(T_NULL, 0)); return i + 4; }
  let ne = i;
  while (ne < end) { const c = load<u8>(base + ne); if (c == COMMA || c == RBRACE || c == RBRACK || isWs(c)) break; ne++; }
  store<f64>(slotOut, parseF64(base + i, base + ne));
  return ne;
}

// Match an object key (SRC[koff..koff+klen)) to a schema field index, or -1.
function matchKey(sid: i32, koff: i32, klen: i32): i32 {
  const start = schemaStart[sid], n = schemaCount[sid];
  const src = changetype<usize>(SRC) + koff;
  const keys = changetype<usize>(SCHEMA_KEYS);
  for (let f = 0; f < n; f++) {
    const fi = start + f;
    if (fieldKeyLen[fi] != klen) continue;
    if (memory.compare(src, keys + fieldKeyOff[fi], klen) == 0) return f;
  }
  return -1;
}

// Parse an object at SRC[p0..end) into a fresh m-slot array (m = schema fields),
// scattering each value to slots[fieldIndex]. Returns the slots ptr.
function objectInto(sid: i32, p0: i32, end: i32): usize {
  const base = changetype<usize>(SRC);
  const m = schemaCount[sid];
  const slots = changetype<usize>(ARENA) + bump;
  bump += <usize>m << 3;
  for (let f = 0; f < m; f++) store<u64>(slots + (<usize>f << 3), ABSENT_SLOT);

  let i = p0;
  while (i < end && isWs(load<u8>(base + i))) i++;
  if (i >= end || load<u8>(base + i) != LBRACE) return slots;
  i++;
  while (i < end) {
    while (i < end && isWs(load<u8>(base + i))) i++;
    if (load<u8>(base + i) == RBRACE) break;
    if (load<u8>(base + i) != QUOTE) break;
    const ks = i + 1, ke = skipString(ks, end);
    i = ke + 1;
    while (i < end && isWs(load<u8>(base + i))) i++;
    if (load<u8>(base + i) != COLON) break;
    i++;
    const fi = matchKey(sid, ks, ke - ks);
    i = parseValue(i, end, fi >= 0 ? slots + (<usize>fi << 3) : changetype<usize>(SCRATCH));
    while (i < end && isWs(load<u8>(base + i))) i++;
    const sep = load<u8>(base + i);
    if (sep == COMMA) { i++; continue; }
    break;
  }
  return slots;
}

// Parse an array at SRC[p0..end) into [count u32][pad u32][slot u64 ...].
function arrayInto(p0: i32, end: i32): usize {
  const base = changetype<usize>(SRC);
  const region = changetype<usize>(ARENA) + bump;
  let rec = region + 8, count = 0, i = p0;
  while (i < end && isWs(load<u8>(base + i))) i++;
  if (i < end && load<u8>(base + i) == LBRACK) {
    i++;
    while (i < end) {
      while (i < end && isWs(load<u8>(base + i))) i++;
      if (load<u8>(base + i) == RBRACK) break;
      i = parseValue(i, end, rec);
      rec += 8; count++;
      while (i < end && isWs(load<u8>(base + i))) i++;
      const sep = load<u8>(base + i);
      if (sep == COMMA) { i++; continue; }
      break;
    }
  }
  store<u32>(region, <u32>count);
  bump = (rec - changetype<usize>(ARENA) + 7) & ~7;
  return region;
}

// ---- exports -------------------------------------------------------------
export function parseObject(sid: i32, len: i32): usize { bump = 0; return objectInto(sid, 0, len); }
export function enterObject(sid: i32, off: i32, len: i32): usize { return objectInto(sid, off, off + len); }
export function enterArray(off: i32, len: i32): usize { return arrayInto(off, off + len); }

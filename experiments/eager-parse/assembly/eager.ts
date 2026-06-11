// Fast EAGER parser -> flat, contiguous, JS-digestible record buffer.
//
// Schema-directed: parse a top-level array of flat objects in ONE pass into a
// contiguous row-major buffer JS reads with typed arrays (zero per-field alloc).
// Layout: [count u32][fieldCount M u32] then count*M slots, 8 bytes each, in
// record order. number/bool -> raw f64; string -> (off u32, len u32) span into
// SRC. Reuses the kernels from src/wasm/parser.ts. v1: flat records only
// (nested objects/arrays stored as NaN). Built --runtime stub --enable simd
// --enable bulk-memory.

const INPUT_CAP: i32 = 16 << 20;
const ARENA_CAP: i32 = 64 << 20;
const SRC = new StaticArray<u8>(INPUT_CAP);
const ARENA = new StaticArray<u8>(ARENA_CAP);
let bump: usize = 0;
const SCRATCH = new StaticArray<u64>(1);

// ---- schema registry (same descriptor as the lazy engine) ----------------
const MAX_FIELDS: i32 = 4096;
const KEYS_CAP: i32 = 64 << 10;
const SCHEMA_KEYS = new StaticArray<u8>(KEYS_CAP);
const fieldKeyOff = new StaticArray<i32>(MAX_FIELDS);
const fieldKeyLen = new StaticArray<i32>(MAX_FIELDS);
const schemaStart = new StaticArray<i32>(256);
const schemaCount = new StaticArray<i32>(256);
let nSchemas = 0, keysBump = 0, fieldsBump = 0;

export function srcPtr(): usize { return changetype<usize>(SRC); }

// descriptor: count × [keyLen u32][key bytes][childSid i32] (childSid ignored here)
export function registerSchema(descPtr: usize, count: i32): i32 {
  const sid = nSchemas++;
  schemaStart[sid] = fieldsBump;
  schemaCount[sid] = count;
  let p = descPtr;
  for (let f = 0; f < count; f++) {
    const klen = load<u32>(p); p += 4;
    const off = keysBump;
    memory.copy(changetype<usize>(SCHEMA_KEYS) + off, p, klen);
    p += klen + 4; // skip key bytes + childSid
    fieldKeyOff[fieldsBump] = off;
    fieldKeyLen[fieldsBump] = <i32>klen;
    fieldsBump++;
    keysBump += <i32>klen;
  }
  return sid;
}

// ---- byte helpers (from parser.ts) ---------------------------------------
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

function skipString(start: i32, end: i32): i32 {
  const base = changetype<usize>(SRC);
  let k = start;
  for (;;) {
    while (k + 16 <= end) {
      const v = v128.load(base + k);
      const m = v128.or(i8x16.eq(v, i8x16.splat(QUOTE)), i8x16.eq(v, i8x16.splat(BACKSLASH)));
      if (v128.any_true(m)) break;
      k += 16;
    }
    while (k < end) { const c = load<u8>(base + k); if (c == BACKSLASH) { k += 2; break; } if (c == QUOTE) return k; k++; }
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

function matchKey(sid: i32, koff: i32, klen: i32): i32 {
  const start = schemaStart[sid], n = schemaCount[sid];
  const src = changetype<usize>(SRC) + koff, keys = changetype<usize>(SCHEMA_KEYS);
  for (let f = 0; f < n; f++) {
    const fi = start + f;
    if (fieldKeyLen[fi] != klen) continue;
    if (memory.compare(src, keys + fieldKeyOff[fi], klen) == 0) return f;
  }
  return -1;
}

const NaN64: f64 = NaN;

// Write the value at SRC[p..end) into the 8-byte slot. number/bool -> f64;
// string -> (off u32, len u32); null/composite -> NaN. Returns value end.
function storeValue(p: i32, end: i32, slot: usize): i32 {
  const base = changetype<usize>(SRC);
  let i = p;
  while (i < end && isWs(load<u8>(base + i))) i++;
  const b = load<u8>(base + i);
  if (b == QUOTE) {
    const cs = i + 1, ce = skipString(cs, end);
    store<u32>(slot, <u32>cs);
    store<u32>(slot + 4, <u32>(ce - cs));
    return ce + 1;
  }
  if (b == LBRACE || b == LBRACK) { store<f64>(slot, NaN64); return scanComposite(i, end); }
  if (b == 0x74) { store<f64>(slot, 1); return i + 4; }
  if (b == 0x66) { store<f64>(slot, 0); return i + 5; }
  if (b == 0x6e) { store<f64>(slot, NaN64); return i + 4; }
  let ne = i;
  while (ne < end) { const c = load<u8>(base + ne); if (c == COMMA || c == RBRACE || c == RBRACK || isWs(c)) break; ne++; }
  store<f64>(slot, parseF64(base + i, base + ne));
  return ne;
}

// Parse one object at SRC[p0..end) into M contiguous slots at recBase.
// Returns position just past the object's '}'.
function recordInto(sid: i32, p0: i32, end: i32, recBase: usize): i32 {
  const base = changetype<usize>(SRC);
  let i = p0;
  while (i < end && isWs(load<u8>(base + i))) i++;
  i++; // '{'
  while (i < end) {
    while (i < end && isWs(load<u8>(base + i))) i++;
    if (load<u8>(base + i) == RBRACE) { i++; break; }
    if (load<u8>(base + i) != QUOTE) break;
    const ks = i + 1, ke = skipString(ks, end);
    i = ke + 1;
    while (i < end && isWs(load<u8>(base + i))) i++;
    if (load<u8>(base + i) != COLON) break;
    i++;
    const fi = matchKey(sid, ks, ke - ks);
    i = storeValue(i, end, fi >= 0 ? recBase + (<usize>fi << 3) : changetype<usize>(SCRATCH));
    while (i < end && isWs(load<u8>(base + i))) i++;
    if (load<u8>(base + i) == COMMA) { i++; continue; }
    if (load<u8>(base + i) == RBRACE) { i++; break; }
    break;
  }
  return i;
}

// ---- exports -------------------------------------------------------------
// Parse a top-level array of flat objects -> [count u32][M u32][count*M slots].
export function parseEagerArray(elemSid: i32, len: i32): usize {
  bump = 0;
  const base = changetype<usize>(SRC);
  const m = schemaCount[elemSid];
  const region = changetype<usize>(ARENA) + bump;
  bump += 8; // header
  let i = 0, count = 0;
  while (i < len && isWs(load<u8>(base + i))) i++;
  if (i < len && load<u8>(base + i) == LBRACK) {
    i++;
    while (i < len) {
      while (i < len && isWs(load<u8>(base + i))) i++;
      if (load<u8>(base + i) == RBRACK) { i++; break; }
      if (load<u8>(base + i) == LBRACE) {
        const recBase = changetype<usize>(ARENA) + bump;
        bump += <usize>m << 3;
        for (let f = 0; f < m; f++) store<f64>(recBase + (<usize>f << 3), 0);
        i = recordInto(elemSid, i, len, recBase);
        count++;
      } else { i = scanComposite(i, len); }
      while (i < len && isWs(load<u8>(base + i))) i++;
      if (load<u8>(base + i) == COMMA) { i++; continue; }
      if (load<u8>(base + i) == RBRACK) { i++; break; }
      break;
    }
  }
  store<u32>(region, <u32>count);
  store<u32>(region + 4, <u32>m);
  return region;
}

// Parse a single flat object -> [1][M][M slots].
export function parseEagerObject(sid: i32, len: i32): usize {
  bump = 0;
  const m = schemaCount[sid];
  const region = changetype<usize>(ARENA) + bump;
  bump += 8;
  const recBase = changetype<usize>(ARENA) + bump;
  bump += <usize>m << 3;
  for (let f = 0; f < m; f++) store<f64>(recBase + (<usize>f << 3), 0);
  recordInto(sid, 0, len, recBase);
  store<u32>(region, 1);
  store<u32>(region + 4, <u32>m);
  return region;
}

// Fast EAGER parser -> flat tables linked by pointers.
//
// Every value level is a contiguous table: [count u32][M u32] then count*M
// 8-byte slots. Scalars are materialized inline; a NESTED object/array/prim-
// array becomes ITS OWN flat table and the parent slot holds a u32 POINTER to
// that table's region. JS reads each table via typed arrays and follows
// pointers — zero per-field allocation. Reuses the lazy engine's kernels.
// Built --runtime stub --enable simd --enable bulk-memory.

const INPUT_CAP: i32 = 16 << 20;
const ARENA_CAP: i32 = 64 << 20;
const SRC = new StaticArray<u8>(INPUT_CAP);
const ARENA = new StaticArray<u8>(ARENA_CAP);
const TMP = new StaticArray<u64>(1 << 20); // record buffer for array contiguity
let bump: usize = 0;
let tsp: i32 = 0;
let pend: i32 = 0; // end of the last value parsed
const SCRATCH = new StaticArray<u64>(1);

// ---- schema registry (descriptor: [keyLen u32][bytes][childSid i32]) ------
const MAX_FIELDS: i32 = 4096;
const KEYS_CAP: i32 = 64 << 10;
const SCHEMA_KEYS = new StaticArray<u8>(KEYS_CAP);
const fieldKeyOff = new StaticArray<i32>(MAX_FIELDS);
const fieldKeyLen = new StaticArray<i32>(MAX_FIELDS);
const fieldChild = new StaticArray<i32>(MAX_FIELDS);
const schemaStart = new StaticArray<i32>(256);
const schemaCount = new StaticArray<i32>(256);
let nSchemas = 0, keysBump = 0, fieldsBump = 0;

export function srcPtr(): usize { return changetype<usize>(SRC); }

export function registerSchema(descPtr: usize, count: i32): i32 {
  const sid = nSchemas++;
  schemaStart[sid] = fieldsBump;
  schemaCount[sid] = count;
  let p = descPtr;
  for (let f = 0; f < count; f++) {
    const klen = load<u32>(p); p += 4;
    const off = keysBump;
    memory.copy(changetype<usize>(SCHEMA_KEYS) + off, p, klen);
    p += klen;
    fieldKeyOff[fieldsBump] = off;
    fieldKeyLen[fieldsBump] = <i32>klen;
    fieldChild[fieldsBump] = load<i32>(p); p += 4;
    fieldsBump++;
    keysBump += <i32>klen;
  }
  return sid;
}

const MODE_PRIM: i32 = -1, MODE_LEAF: i32 = -2;

// ---- byte helpers / kernels (from parser.ts) -----------------------------
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
    while (k + 16 <= end) { const v = v128.load(base + k); if (v128.any_true(v128.or(i8x16.eq(v, i8x16.splat(QUOTE)), i8x16.eq(v, i8x16.splat(BACKSLASH))))) break; k += 16; }
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
  for (let f = 0; f < n; f++) { const fi = start + f; if (fieldKeyLen[fi] != klen) continue; if (memory.compare(src, keys + fieldKeyOff[fi], klen) == 0) return f; }
  return -1;
}

const NaN64: f64 = NaN;

// Write the value at SRC[p..end) into `slot` under `child` mode; set pend.
//   number/bool -> f64 · string -> (off u32, len u32) · nested -> u32 ptr to sub-table
function storeField(p: i32, end: i32, slot: usize, child: i32): void {
  const base = changetype<usize>(SRC);
  let i = p;
  while (i < end && isWs(load<u8>(base + i))) i++;
  const b = load<u8>(base + i);
  if (b == QUOTE) { const cs = i + 1, ce = skipString(cs, end); store<u32>(slot, <u32>cs); store<u32>(slot + 4, <u32>(ce - cs)); pend = ce + 1; return; }
  if (b == LBRACE) {
    if (child >= 0) { store<u32>(slot, <u32>objTable(child, i, end)); /* pend set by objTable */ }
    else { store<f64>(slot, NaN64); pend = scanComposite(i, end); }
    return;
  }
  if (b == LBRACK) {
    if (child >= 0) store<u32>(slot, <u32>arrTable(child, i, end));
    else if (child == MODE_PRIM) store<u32>(slot, <u32>primTable(i, end));
    else { store<f64>(slot, NaN64); pend = scanComposite(i, end); }
    return;
  }
  if (b == 0x74) { store<f64>(slot, 1); pend = i + 4; return; }
  if (b == 0x66) { store<f64>(slot, 0); pend = i + 5; return; }
  if (b == 0x6e) { store<f64>(slot, 0); pend = i + 4; return; } // null -> zero (num 0 / str "")
  let ne = i;
  while (ne < end) { const c = load<u8>(base + ne); if (c == COMMA || c == RBRACE || c == RBRACK || isWs(c)) break; ne++; }
  store<f64>(slot, parseF64(base + i, base + ne)); pend = ne;
}

// Fill one object's M slots at recBase; set pend to just past '}'.
function recordInto(sid: i32, p0: i32, end: i32, recBase: usize): void {
  const base = changetype<usize>(SRC);
  const start = schemaStart[sid];
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
    storeField(i, end, fi >= 0 ? recBase + (<usize>fi << 3) : changetype<usize>(SCRATCH), fi >= 0 ? fieldChild[start + fi] : MODE_LEAF);
    i = pend;
    while (i < end && isWs(load<u8>(base + i))) i++;
    if (load<u8>(base + i) == COMMA) { i++; continue; }
    if (load<u8>(base + i) == RBRACE) { i++; break; }
    break;
  }
  pend = i;
}

// Single object -> [1][M] table. Returns region ptr.
function objTable(sid: i32, p0: i32, end: i32): usize {
  const m = schemaCount[sid];
  const region = changetype<usize>(ARENA) + bump;
  bump += 8;
  const recBase = changetype<usize>(ARENA) + bump;
  bump += <usize>m << 3; // reserve the M slots before recursing
  for (let f = 0; f < m; f++) store<f64>(recBase + (<usize>f << 3), 0);
  recordInto(sid, p0, end, recBase);
  store<u32>(region, 1); store<u32>(region + 4, <u32>m);
  return region;
}

// Array of objects -> [N][Melem] table (records contiguous via TMP). Returns region ptr.
function arrTable(elemSid: i32, p0: i32, end: i32): usize {
  const base = changetype<usize>(SRC);
  const tmp = changetype<usize>(TMP);
  const m = schemaCount[elemSid];
  const baseTsp = tsp;
  let i = p0 + 1;
  while (i < end) {
    while (i < end && isWs(load<u8>(base + i))) i++;
    const b = load<u8>(base + i);
    if (b == RBRACK) { i++; break; }
    if (b == LBRACE) {
      const recBase = tmp + (<usize>tsp << 3);
      tsp += m; // reserve in TMP before recursing (nested uses TMP above)
      for (let f = 0; f < m; f++) store<f64>(recBase + (<usize>f << 3), 0);
      recordInto(elemSid, i, end, recBase);
      i = pend;
    } else { i = scanComposite(i, end); }
    while (i < end && isWs(load<u8>(base + i))) i++;
    if (load<u8>(base + i) == COMMA) { i++; continue; }
    if (load<u8>(base + i) == RBRACK) { i++; break; }
    break;
  }
  const slots = tsp - baseTsp, count = m > 0 ? slots / m : 0;
  const region = changetype<usize>(ARENA) + bump;
  bump += 8;
  memory.copy(changetype<usize>(ARENA) + bump, tmp + (<usize>baseTsp << 3), <usize>slots << 3);
  bump += <usize>slots << 3;
  store<u32>(region, <u32>count); store<u32>(region + 4, <u32>m);
  tsp = baseTsp; pend = i;
  return region;
}

// Primitive array -> [N][1] table (leaf elements, contiguous). Returns region ptr.
function primTable(p0: i32, end: i32): usize {
  const base = changetype<usize>(SRC);
  const region = changetype<usize>(ARENA) + bump;
  bump += 8;
  const recBase = changetype<usize>(ARENA) + bump;
  let i = p0 + 1, count = 0;
  while (i < end) {
    while (i < end && isWs(load<u8>(base + i))) i++;
    if (load<u8>(base + i) == RBRACK) { i++; break; }
    storeField(i, end, recBase + (<usize>count << 3), MODE_LEAF);
    i = pend; count++;
    while (i < end && isWs(load<u8>(base + i))) i++;
    if (load<u8>(base + i) == COMMA) { i++; continue; }
    if (load<u8>(base + i) == RBRACK) { i++; break; }
    break;
  }
  bump += <usize>count << 3;
  store<u32>(region, <u32>count); store<u32>(region + 4, 1);
  pend = i;
  return region;
}

// ---- exports -------------------------------------------------------------
export function parseEagerObject(sid: i32, len: i32): usize { bump = 0; tsp = 0; return objTable(sid, 0, len); }
export function parseEagerArray(elemSid: i32, len: i32): usize { bump = 0; tsp = 0; return arrTable(elemSid, 0, len); }
export function parseEagerPrim(len: i32): usize { bump = 0; tsp = 0; return primTable(0, len); }

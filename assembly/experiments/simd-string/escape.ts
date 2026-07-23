// SIMD JSON-string escape scanner.
//
// A JSON string serializer's hot work is finding bytes that need escaping:
//   b < 0x20  (control) || b == 0x22 (") || b == 0x5c (\)
// For the common clean string, the output is just the input wrapped in quotes,
// so the scan IS the work. This does it 16 bytes at a time with v128.
//
// Built --runtime stub --enable simd.

export const CAP: i32 = 4 << 20; // 4 MiB (u16 path needs 2 bytes/char)
const SRC = new StaticArray<u8>(CAP);
const OUT = new StaticArray<u8>(8 << 20); // escaped output (≤6× expansion + quotes)

export function srcPtr(): usize { return changetype<usize>(SRC); }
export function outPtr(): usize { return changetype<usize>(OUT); }

// @ts-ignore: inline
@inline function hexDigit(n: u8): u8 { return n < 10 ? (0x30 + n) : (0x61 + (n - 10)); }

// Write the JSON escape for byte `b` at `dst`; return the advanced pointer.
// @ts-ignore: inline
@inline function writeEscape(dst: usize, b: u8): usize {
  store<u8>(dst, 0x5c); // backslash
  switch (b) {
    case 0x22: { store<u8>(dst + 1, 0x22); return dst + 2; } // \"
    case 0x5c: { store<u8>(dst + 1, 0x5c); return dst + 2; } // \\
    case 0x08: { store<u8>(dst + 1, 0x62); return dst + 2; } // \b
    case 0x09: { store<u8>(dst + 1, 0x74); return dst + 2; } // \t
    case 0x0a: { store<u8>(dst + 1, 0x6e); return dst + 2; } // \n
    case 0x0c: { store<u8>(dst + 1, 0x66); return dst + 2; } // \f
    case 0x0d: { store<u8>(dst + 1, 0x72); return dst + 2; } // \r
    default: {
      store<u8>(dst + 1, 0x75); // u
      store<u8>(dst + 2, 0x30); // 0
      store<u8>(dst + 3, 0x30); // 0
      store<u8>(dst + 4, hexDigit(b >> 4));
      store<u8>(dst + 5, hexDigit(b & 0x0f));
      return dst + 6;
    }
  }
}

/** Full JSON string serialize of SRC[0..len): writes `"..."` with escapes into
 *  OUT, returns output byte length. SIMD-skips clean 16B runs (bulk-copied),
 *  escapes each offending byte. Matches JSON.stringify byte-for-byte. */
export function escape(len: i32): i32 {
  const src = changetype<usize>(SRC);
  const dst = changetype<usize>(OUT);
  const Q = v128.splat<u8>(0x22);
  const B = v128.splat<u8>(0x5c);
  const SP = v128.splat<u8>(0x20);
  let i = 0;
  let o = dst;
  store<u8>(o, 0x22); o++; // opening quote
  while (i < len) {
    const runStart = i;
    while (i + 16 <= len) {
      const v = v128.load(src + i);
      const ctrl = i8x16.sub_sat_u(SP, v);
      const m = v128.or(v128.or(ctrl, i8x16.eq(v, Q)), i8x16.eq(v, B));
      if (v128.any_true(m)) break;
      i += 16;
    }
    while (i < len && !needsEscape(load<u8>(src + i))) i++;
    const runLen = i - runStart;
    if (runLen > 0) { memory.copy(o, src + runStart, runLen); o += runLen; }
    if (i >= len) break;
    o = writeEscape(o, load<u8>(src + i));
    i++;
  }
  store<u8>(o, 0x22); o++; // closing quote
  return <i32>(o - dst);
}

// @ts-ignore: inline
@inline function needsEscape(b: u8): bool {
  return b < 0x20 || b == 0x22 || b == 0x5c;
}

/** Index of the first byte needing a JSON escape, or `len` if the string is
 *  clean. SIMD-scans 16B blocks; only the rare dirty block falls to a scalar
 *  locate. */
export function firstEscape(len: i32): i32 {
  const base = changetype<usize>(SRC);
  const Q = v128.splat<u8>(0x22);
  const B = v128.splat<u8>(0x5c);
  const SP = v128.splat<u8>(0x20);
  let i = 0;
  while (i + 16 <= len) {
    const v = v128.load(base + i);
    // sub_sat_u(0x20, b) is nonzero exactly where b < 0x20
    const ctrl = i8x16.sub_sat_u(SP, v);
    const m = v128.or(v128.or(ctrl, i8x16.eq(v, Q)), i8x16.eq(v, B));
    if (v128.any_true(m)) {
      for (let j = i; j < i + 16; j++) {
        if (needsEscape(load<u8>(base + j))) return j;
      }
    }
    i += 16;
  }
  while (i < len) {
    if (needsEscape(load<u8>(base + i))) return i;
    i++;
  }
  return len;
}

// @ts-ignore: inline
@inline function needsEscape16(u: u16): bool {
  return u < 0x20 || u == 0x22 || u == 0x5c;
}

/** Same scan over UTF-16 code units (8 per block). JSON's escape-needing chars
 *  are all < 0x80, so scanning UTF-16 is valid and skips the UTF-8 transcode.
 *  `len` is in code units. */
export function firstEscape16(len: i32): i32 {
  const base = changetype<usize>(SRC);
  const Q = v128.splat<u16>(0x22);
  const B = v128.splat<u16>(0x5c);
  const SP = v128.splat<u16>(0x20);
  let i = 0;
  while (i + 8 <= len) {
    const v = v128.load(base + (<usize>i << 1)); // 8 u16 = 16 bytes
    const ctrl = i16x8.sub_sat_u(SP, v);
    const m = v128.or(v128.or(ctrl, i16x8.eq(v, Q)), i16x8.eq(v, B));
    if (v128.any_true(m)) {
      for (let j = i; j < i + 8; j++) {
        if (needsEscape16(load<u16>(base + (<usize>j << 1)))) return j;
      }
    }
    i += 8;
  }
  while (i < len) {
    if (needsEscape16(load<u16>(base + (<usize>i << 1)))) return i;
    i++;
  }
  return len;
}

// SIMD structural tokenizer — bitmask + ctz stage-1 (simdjson-style).
//
// Per 16-byte block: compute a structural/quote bitmask with i8x16.bitmask,
// then ctz-iterate the set bits to emit every token offset from one SIMD op
// (vs one any_true per token in the naive version). When a token is an opening
// quote, the string body is consumed scalar-ly to its close — so the cursor is
// always at a structural position OUTSIDE any string, and no cross-block escape
// state is needed. Built --runtime stub --enable simd.

export const CAP: i32 = 16 << 20;
const SRC = new StaticArray<u8>(CAP);
const TOKENS = new StaticArray<i32>(1 << 22);

export function srcPtr(): usize { return changetype<usize>(SRC); }
export function tokensPtr(): usize { return changetype<usize>(TOKENS); }

const LBRACE: u8 = 0x7b, RBRACE: u8 = 0x7d, LBRACK: u8 = 0x5b, RBRACK: u8 = 0x5d;
const COLON: u8 = 0x3a, COMMA: u8 = 0x2c, QUOTE: u8 = 0x22, BACKSLASH: u8 = 0x5c;

// @ts-ignore: inline
@inline function isCandidate(b: u8): bool {
  return b == LBRACE || b == RBRACE || b == LBRACK || b == RBRACK ||
         b == COLON || b == COMMA || b == QUOTE;
}

// v128 mask: lanes equal to any structural char or a quote (all-ones where set).
// @ts-ignore: inline
@inline function candidateMask(v: v128): v128 {
  const br = v128.or(
    v128.or(i8x16.eq(v, i8x16.splat(LBRACE)), i8x16.eq(v, i8x16.splat(RBRACE))),
    v128.or(i8x16.eq(v, i8x16.splat(LBRACK)), i8x16.eq(v, i8x16.splat(RBRACK))),
  );
  const punct = v128.or(
    v128.or(i8x16.eq(v, i8x16.splat(COLON)), i8x16.eq(v, i8x16.splat(COMMA))),
    i8x16.eq(v, i8x16.splat(QUOTE)),
  );
  return v128.or(br, punct);
}

// Scan a string body from `start` (just past the opening quote) to its closing
// quote, returning the close offset. Bulk-skips clean 16B runs with SIMD;
// scalar only near a quote or backslash (escape).
// @ts-ignore: inline
@inline function skipString(src: usize, start: i32, len: i32): i32 {
  let k = start;
  for (;;) {
    while (k + 16 <= len) {
      const v = v128.load(src + k);
      const m = v128.or(i8x16.eq(v, i8x16.splat(QUOTE)), i8x16.eq(v, i8x16.splat(BACKSLASH)));
      if (v128.any_true(m)) break;
      k += 16;
    }
    while (k < len) {
      const c = load<u8>(src + k);
      if (c == BACKSLASH) { k += 2; break; }  // escape: skip 2, re-enter SIMD
      if (c == QUOTE) return k;
      k++;
    }
    if (k >= len) return k;
  }
  return k; // unreachable
}

/** Tokenize SRC[0..len) into TOKENS (byte offsets). Returns token count. */
export function tokenize(len: i32): i32 {
  const src = changetype<usize>(SRC);
  const tok = changetype<usize>(TOKENS);
  let nt = 0;
  let i = 0;
  const blockEnd = len - 16;

  while (i <= blockEnd) {
    let mask = i8x16.bitmask(candidateMask(v128.load(src + i)));
    if (mask == 0) { i += 16; continue; }
    let stringBroke = false;
    while (mask != 0) {
      const j = i + (ctz(mask) & 31);
      if (load<u8>(src + j) == QUOTE) {
        store<i32>(tok + (nt << 2), j); nt++; // opening quote
        const k = skipString(src, j + 1, len);
        store<i32>(tok + (nt << 2), k); nt++; // closing quote
        i = k + 1;
        stringBroke = true;
        break;
      }
      store<i32>(tok + (nt << 2), j); nt++; // structural
      mask &= mask - 1; // clear lowest set bit
    }
    if (!stringBroke) i += 16;
  }

  // tail (< 16 bytes left, or resumed past a string near the end)
  while (i < len) {
    const b = load<u8>(src + i);
    if (!isCandidate(b)) { i++; continue; }
    if (b == QUOTE) {
      store<i32>(tok + (nt << 2), i); nt++;
      const k = skipString(src, i + 1, len);
      store<i32>(tok + (nt << 2), k); nt++;
      i = k + 1;
    } else {
      store<i32>(tok + (nt << 2), i); nt++;
      i++;
    }
  }
  return nt;
}

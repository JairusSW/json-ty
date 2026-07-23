// SIMD structural tokenizer (simdjson stage-1 style), ported from the
// experiments/simd-string scanner. Emits a token stream: the byte offset of
// every structural character ({ } [ ] : ,) and both quotes of every string.
// Numbers / literals / whitespace are bulk-skipped between tokens.
//
// JS reads the token offsets (one i32 each) and navigates them against the
// schema (see vec3.mjs). Built --runtime stub --enable simd.

export const CAP: i32 = 1 << 20;
const SRC = new StaticArray<u8>(CAP);
const TOKENS = new StaticArray<i32>(1 << 18); // byte offset of each token

export function srcPtr(): usize { return changetype<usize>(SRC); }
export function tokensPtr(): usize { return changetype<usize>(TOKENS); }

const LBRACE: u8 = 0x7b, RBRACE: u8 = 0x7d;
const LBRACK: u8 = 0x5b, RBRACK: u8 = 0x5d;
const COLON: u8 = 0x3a, COMMA: u8 = 0x2c, QUOTE: u8 = 0x22, BACKSLASH: u8 = 0x5c;

// @ts-ignore: inline
@inline function isCandidate(b: u8): bool {
  return b == LBRACE || b == RBRACE || b == LBRACK || b == RBRACK ||
         b == COLON || b == COMMA || b == QUOTE;
}

// v128 mask of lanes equal to any structural char or a quote.
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

/** Tokenize SRC[0..len) into TOKENS (byte offsets). Returns token count. */
export function tokenize(len: i32): i32 {
  const src = changetype<usize>(SRC);
  const tok = changetype<usize>(TOKENS);
  let nt = 0;
  let i = 0;
  while (i < len) {
    // bulk-skip 16B runs with no structural/quote byte (numbers, ws, words)
    while (i + 16 <= len && !v128.any_true(candidateMask(v128.load(src + i)))) i += 16;
    // scalar advance to the next candidate in the partial block
    while (i < len && !isCandidate(load<u8>(src + i))) i++;
    if (i >= len) break;

    const b = load<u8>(src + i);
    if (b == QUOTE) {
      store<i32>(tok + (nt << 2), i); nt++; // opening quote
      i++;
      while (i < len) {
        const c = load<u8>(src + i);
        if (c == BACKSLASH) { i += 2; continue; } // skip escaped char
        if (c == QUOTE) break;
        i++;
      }
      store<i32>(tok + (nt << 2), i); nt++; // closing quote
      i++;
    } else {
      store<i32>(tok + (nt << 2), i); nt++; // structural
      i++;
    }
  }
  return nt;
}

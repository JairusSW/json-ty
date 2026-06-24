// SIMD structural tokenizer — bitmask + ctz stage-1 (simdjson-style).
//
// Per 16-byte block: compute a structural/quote bitmask with i8x16.bitmask,
// then ctz-iterate the set bits to emit every token offset from one SIMD op
// (vs one any_true per token in the naive version). When a token is an opening
// quote, the string body is consumed scalar-ly to its close — so the cursor is
// always at a structural position OUTSIDE any string, and no cross-block escape
// state is needed. Built --runtime stub --enable simd.
export const CAP = 16 << 20;
const SRC = new StaticArray(CAP);
const TOKENS = new StaticArray(1 << 22);
export function srcPtr() { return changetype(SRC); }
export function tokensPtr() { return changetype(TOKENS); }
const LBRACE = 0x7b, RBRACE = 0x7d, LBRACK = 0x5b, RBRACK = 0x5d;
const COLON = 0x3a, COMMA = 0x2c, QUOTE = 0x22, BACKSLASH = 0x5c;
// @ts-ignore: inline
function isCandidate(b) {
    return b == LBRACE || b == RBRACE || b == LBRACK || b == RBRACK ||
        b == COLON || b == COMMA || b == QUOTE;
}
// v128 mask: lanes equal to any structural char or a quote (all-ones where set).
// @ts-ignore: inline
function candidateMask(v) {
    const br = v128.or(v128.or(i8x16.eq(v, i8x16.splat(LBRACE)), i8x16.eq(v, i8x16.splat(RBRACE))), v128.or(i8x16.eq(v, i8x16.splat(LBRACK)), i8x16.eq(v, i8x16.splat(RBRACK))));
    const punct = v128.or(v128.or(i8x16.eq(v, i8x16.splat(COLON)), i8x16.eq(v, i8x16.splat(COMMA))), i8x16.eq(v, i8x16.splat(QUOTE)));
    return v128.or(br, punct);
}
// Scan a string body from `start` (just past the opening quote) to its closing
// quote, returning the close offset. Bulk-skips clean 16B runs with SIMD;
// scalar only near a quote or backslash (escape).
// @ts-ignore: inline
function skipString(src, start, len) {
    let k = start;
    for (;;) {
        while (k + 16 <= len) {
            const v = v128.load(src + k);
            const m = v128.or(i8x16.eq(v, i8x16.splat(QUOTE)), i8x16.eq(v, i8x16.splat(BACKSLASH)));
            if (v128.any_true(m))
                break;
            k += 16;
        }
        while (k < len) {
            const c = load(src + k);
            if (c == BACKSLASH) {
                k += 2;
                break;
            } // escape: skip 2, re-enter SIMD
            if (c == QUOTE)
                return k;
            k++;
        }
        if (k >= len)
            return k;
    }
    return k; // unreachable
}
/** Tokenize SRC[0..len) into TOKENS (byte offsets). Returns token count. */
export function tokenize(len) {
    const src = changetype(SRC);
    const tok = changetype(TOKENS);
    let nt = 0;
    let i = 0;
    const blockEnd = len - 16;
    while (i <= blockEnd) {
        let mask = i8x16.bitmask(candidateMask(v128.load(src + i)));
        if (mask == 0) {
            i += 16;
            continue;
        }
        let stringBroke = false;
        while (mask != 0) {
            const j = i + (ctz(mask) & 31);
            if (load(src + j) == QUOTE) {
                store(tok + (nt << 2), j);
                nt++; // opening quote
                const k = skipString(src, j + 1, len);
                store(tok + (nt << 2), k);
                nt++; // closing quote
                i = k + 1;
                stringBroke = true;
                break;
            }
            store(tok + (nt << 2), j);
            nt++; // structural
            mask &= mask - 1; // clear lowest set bit
        }
        if (!stringBroke)
            i += 16;
    }
    // tail (< 16 bytes left, or resumed past a string near the end)
    while (i < len) {
        const b = load(src + i);
        if (!isCandidate(b)) {
            i++;
            continue;
        }
        if (b == QUOTE) {
            store(tok + (nt << 2), i);
            nt++;
            const k = skipString(src, i + 1, len);
            store(tok + (nt << 2), k);
            nt++;
            i = k + 1;
        }
        else {
            store(tok + (nt << 2), i);
            nt++;
            i++;
        }
    }
    return nt;
}

const QUOTE: u8 = 0x22;
const BACKSLASH: u8 = 0x5c;

// Port of simdjson's lookup4 UTF-8 classifier tables. Each error class owns a
// bit, so the three nibble lookups intersect to a non-zero byte only for an
// invalid adjacent-byte combination.
const UTF8_BYTE1_HIGH: usize = memory.data<u8>([2,2,2,2,2,2,2,2,128,128,128,128,33,1,21,73]);
const UTF8_BYTE1_LOW: usize = memory.data<u8>([231,163,131,131,139,203,203,203,203,203,203,203,203,219,203,203]);
const UTF8_BYTE2_HIGH: usize = memory.data<u8>([1,1,1,1,1,1,1,1,230,174,186,186,1,1,1,1]);
const UTF8_LANES: usize = memory.data<u8>([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);


@inline
function isHex(value: u8): bool {
  return (value >= 0x30 && value <= 0x39) || (value >= 0x41 && value <= 0x46) || (value >= 0x61 && value <= 0x66);
}


@inline
function validShortEscape(value: u8): bool {
  return value == QUOTE || value == BACKSLASH || value == 0x2f || value == 0x62 || value == 0x66 || value == 0x6e || value == 0x72 || value == 0x74;
}


@inline
function continuation(value: u8): bool {
  return (value & 0xc0) == 0x80;
}

function skipUtf8Scalar(pointer: usize, end: usize): usize {
  const first = load<u8>(pointer);
  if (first < 0x80) return pointer + 1;
  if (first >= 0xc2 && first <= 0xdf) {
    return pointer + 2 <= end && continuation(load<u8>(pointer + 1)) ? pointer + 2 : 0;
  }
  if (first >= 0xe0 && first <= 0xef) {
    if (pointer + 3 > end) return 0;
    const second = load<u8>(pointer + 1);
    if (!continuation(load<u8>(pointer + 2)) || (first == 0xe0 ? second < 0xa0 || second > 0xbf : first == 0xed ? second < 0x80 || second > 0x9f : !continuation(second))) return 0;
    return pointer + 3;
  }
  if (first >= 0xf0 && first <= 0xf4) {
    if (pointer + 4 > end) return 0;
    const second = load<u8>(pointer + 1);
    if ((first == 0xf0 ? second < 0x90 || second > 0xbf : first == 0xf4 ? second < 0x80 || second > 0x8f : !continuation(second)) || !continuation(load<u8>(pointer + 2)) || !continuation(load<u8>(pointer + 3))) return 0;
    return pointer + 4;
  }
  return 0;
}


@inline
function specialMask(block: v128, trusted: bool): i32 {
  let candidates = v128.or(v128.or(i8x16.eq(block, i8x16.splat(QUOTE)), i8x16.eq(block, i8x16.splat(BACKSLASH))), i8x16.lt_u(block, i8x16.splat(0x20)));
  if (!trusted) candidates = v128.or(candidates, i8x16.lt_s(block, i8x16.splat(0)));
  return i8x16.bitmask(candidates);
}

@inline
function previous1(previous: v128, input: v128): v128 {
  return i8x16.shuffle(previous, input, 15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30);
}

@inline
function previous2(previous: v128, input: v128): v128 {
  return i8x16.shuffle(previous, input, 14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29);
}

@inline
function previous3(previous: v128, input: v128): v128 {
  return i8x16.shuffle(previous, input, 13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28);
}

@inline
function lookup4Error(input: v128, previous: v128): v128 {
  const prev1 = previous1(previous, input);
  const high1 = i8x16.swizzle(v128.load(UTF8_BYTE1_HIGH), i8x16.shr_u(prev1, 4));
  const low1 = i8x16.swizzle(v128.load(UTF8_BYTE1_LOW), v128.and(prev1, i8x16.splat(0x0f)));
  const high2 = i8x16.swizzle(v128.load(UTF8_BYTE2_HIGH), i8x16.shr_u(input, 4));
  const special = v128.and(v128.and(high1, low1), high2);
  const prev2 = previous2(previous, input);
  const prev3 = previous3(previous, input);
  const must23 = v128.or(i8x16.sub_sat_u(prev2, i8x16.splat(0x60)), i8x16.sub_sat_u(prev3, i8x16.splat(0x70)));
  return v128.xor(v128.and(must23, i8x16.splat(<i8>0x80)), special);
}

/**
 * Candidate scanner using simdjson's lookup4 UTF-8 validation. Escape-bearing
 * blocks fall back to the established scanner; clean Unicode remains vectorized.
 */
export function scanString_SIMD_LOOKUP4(start: usize, end: usize, trusted: bool): u64 {
  if (trusted) return scanString_SIMD_INNER(start, end, true, false);
  if (start >= end || load<u8>(start) != QUOTE) return 0;
  let pointer = start + 1;
  let previous = i8x16.splat(0);
  let errors = i8x16.splat(0);
  const lanes = v128.load(UTF8_LANES);
  while (pointer < end) {
    const remaining = <i32>min(<usize>16, end - pointer);
    const valid = i8x16.lt_u(lanes, i8x16.splat(<u8>remaining));
    let block = v128.and(v128.load(pointer), valid);
    const candidates = v128.and(v128.or(v128.or(i8x16.eq(block, i8x16.splat(QUOTE)), i8x16.eq(block, i8x16.splat(BACKSLASH))), i8x16.lt_u(block, i8x16.splat(0x20))), valid);
    const mask = i8x16.bitmask(candidates);
    if (mask != 0) {
      const index = ctz(mask);
      const value = load<u8>(pointer + index);
      if (value != QUOTE) return scanString_SIMD_INNER(start, end, false, false);
      block = v128.and(block, i8x16.lt_u(lanes, i8x16.splat(<u8>index)));
      if ((i8x16.bitmask(block) | i8x16.bitmask(previous)) != 0) errors = v128.or(errors, lookup4Error(block, previous));
      return v128.any_true(errors) ? 0 : ((<u64>(pointer + index + 1)) << 32);
    }
    if ((i8x16.bitmask(block) | i8x16.bitmask(previous)) != 0) errors = v128.or(errors, lookup4Error(block, previous));
    previous = block;
    pointer += 16;
  }
  return 0;
}

/**
 * Scan a quoted UTF-8 JSON string with 16-byte SIMD classification.
 *
 * The high 32 bits contain the byte after the closing quote and bit zero
 * records whether the retained payload contains an escape. Zero is failure.
 */
function scanString_SIMD_INNER(start: usize, end: usize, trusted: bool, useLookup4: bool): u64 {
  if (start >= end || load<u8>(start) != QUOTE) return 0;
  let pointer = start + 1;
  let escaped = false;

  while (pointer < end) {
    while (end - pointer >= 16) {
      const mask = specialMask(v128.load(pointer), trusted);
      if (mask != 0) {
        pointer += <usize>ctz(mask);
        break;
      }
      pointer += 16;
    }

    while (pointer < end) {
      const value = load<u8>(pointer);
      if (value == QUOTE) {
        return ((<u64>(pointer + 1)) << 32) | (<u64>(escaped ? 1 : 0));
      }
      if (value < 0x20) return 0;
      if (value == BACKSLASH) {
        escaped = true;
        pointer++;
        if (pointer >= end) return 0;
        const escape = load<u8>(pointer);
        if (escape == 0x75) {
          if (pointer + 5 > end || !isHex(load<u8>(pointer + 1)) || !isHex(load<u8>(pointer + 2)) || !isHex(load<u8>(pointer + 3)) || !isHex(load<u8>(pointer + 4))) return 0;
          pointer += 5;
        } else {
          if (!validShortEscape(escape)) return 0;
          pointer++;
        }
        break;
      }
      if (!trusted && value >= 0x80) {
        if (useLookup4) return scanString_SIMD_LOOKUP4(start, end, false);
        pointer = skipUtf8Scalar(pointer, end);
        if (pointer == 0) return 0;
      } else {
        pointer++;
      }
    }
  }
  return 0;
}

export function scanString_SIMD(start: usize, end: usize, trusted: bool): u64 {
  return scanString_SIMD_INNER(start, end, trusted, true);
}

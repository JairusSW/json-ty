const QUOTE: u8 = 0x22;
const BACKSLASH: u8 = 0x5c;


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

/**
 * Scan a quoted UTF-8 JSON string with 16-byte SIMD classification.
 *
 * The high 32 bits contain the byte after the closing quote and bit zero
 * records whether the retained payload contains an escape. Zero is failure.
 */
export function scanString_SIMD(start: usize, end: usize, trusted: bool): u64 {
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
        pointer = skipUtf8Scalar(pointer, end);
        if (pointer == 0) return 0;
      } else {
        pointer++;
      }
    }
  }
  return 0;
}

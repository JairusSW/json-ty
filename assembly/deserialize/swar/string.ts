const BACK_SLASH: u8 = 0x5c;
const QUOTE: u8 = 0x22;

// Retained UTF-8 span scanner adapted from json-as's SWAR field-string path.
//
// Return layout:
//   high 32 bits: pointer immediately after the closing quote
//   low bit:      source payload contains at least one JSON escape
// Zero means malformed or unterminated input. The caller retains the original
// payload start, so no UTF-16 string or GC allocation is introduced.

const ONES: u64 = 0x0101_0101_0101_0101;
const HIGH: u64 = 0x8080_8080_8080_8080;
const QUOTES: u64 = 0x2222_2222_2222_2222;
const SLASHES: u64 = 0x5c5c_5c5c_5c5c_5c5c;
const CONTROL_BITS: u64 = 0xe0e0_e0e0_e0e0_e0e0;

@inline
function zeroByteCandidates(value: u64): u64 {
  return (value - ONES) & ~value & HIGH;
}

@inline
function trustedSpecialMask(block: u64): u64 {
  return zeroByteCandidates(block ^ QUOTES) |
    zeroByteCandidates(block ^ SLASHES) |
    zeroByteCandidates(block & CONTROL_BITS);
}

@inline
function strictSpecialMask(block: u64): u64 {
  return trustedSpecialMask(block) | (block & HIGH);
}

@inline
function isHex(value: u8): bool {
  return (value >= 0x30 && value <= 0x39) ||
    (value >= 0x41 && value <= 0x46) ||
    (value >= 0x61 && value <= 0x66);
}

@inline
function isShortEscape(value: u8): bool {
  return value == QUOTE ||
    value == BACK_SLASH ||
    value == 0x2f ||
    value == 0x62 ||
    value == 0x66 ||
    value == 0x6e ||
    value == 0x72 ||
    value == 0x74;
}

@inline
function isContinuation(value: u8): bool {
  return (value & 0xc0) == 0x80;
}

// Validate exactly one shortest-form UTF-8 scalar. Surrogate encodings,
// overlong forms, and values above U+10FFFF return zero.
function skipUtf8Scalar(pointer: usize, end: usize): usize {
  const first = load<u8>(pointer);
  if (first < 0x80) return pointer + 1;
  if (first >= 0xc2 && first <= 0xdf) {
    if (pointer + 2 > end || !isContinuation(load<u8>(pointer + 1))) return 0;
    return pointer + 2;
  }
  if (first >= 0xe0 && first <= 0xef) {
    if (pointer + 3 > end) return 0;
    const second = load<u8>(pointer + 1);
    const third = load<u8>(pointer + 2);
    if (!isContinuation(third)) return 0;
    if (first == 0xe0) {
      if (second < 0xa0 || second > 0xbf) return 0;
    } else if (first == 0xed) {
      if (second < 0x80 || second > 0x9f) return 0;
    } else if (!isContinuation(second)) {
      return 0;
    }
    return pointer + 3;
  }
  if (first >= 0xf0 && first <= 0xf4) {
    if (pointer + 4 > end) return 0;
    const second = load<u8>(pointer + 1);
    if (first == 0xf0) {
      if (second < 0x90 || second > 0xbf) return 0;
    } else if (first == 0xf4) {
      if (second < 0x80 || second > 0x8f) return 0;
    } else if (!isContinuation(second)) {
      return 0;
    }
    if (
      !isContinuation(load<u8>(pointer + 2)) ||
      !isContinuation(load<u8>(pointer + 3))
    ) return 0;
    return pointer + 4;
  }
  return 0;
}

@inline
function result(next: usize, escaped: bool): u64 {
  return (<u64>next << 32) | <u64>(escaped ? 1 : 0);
}

/**
 * Scan one quoted JSON string as retained UTF-8.
 *
 * The wide pre-scan preserves json-as's first-word-before-second ordering,
 * 16-byte clean stride, 8-byte remainder stride, candidate confirmation, and
 * scalar escape handling. Strict mode additionally makes every non-ASCII byte
 * a scalar-validation candidate; trusted mode relies on host UTF-8 ingress.
 */
export function scanString_SWAR(
  start: usize,
  end: usize,
  trusted: bool = false,
): u64 {
  if (start >= end || load<u8>(start) != QUOTE) return 0;

  let pointer = start + 1;
  let escaped = false;
  let pendingMask: u64 = 0;

  if (end >= 16) {
    const end16 = end - 16;
    while (pointer <= end16) {
      const first = load<u64>(pointer);
      const firstMask = trusted
        ? trustedSpecialMask(first)
        : strictSpecialMask(first);
      if (firstMask != 0) {
        pendingMask = firstMask;
        break;
      }

      const second = load<u64>(pointer, 8);
      const secondMask = trusted
        ? trustedSpecialMask(second)
        : strictSpecialMask(second);
      if (secondMask != 0) {
        pointer += 8;
        pendingMask = secondMask;
        break;
      }
      pointer += 16;
    }
  }

  const end8 = end >= 8 ? end - 8 : 0;
  while (pointer <= end8) {
    let mask = pendingMask;
    if (mask == 0) {
      const block = load<u64>(pointer);
      mask = trusted ? trustedSpecialMask(block) : strictSpecialMask(block);
    }
    pendingMask = 0;
    if (mask == 0) {
      pointer += 8;
      continue;
    }
    pointer += <usize>(ctz(mask) >> 3);

    while (pointer < end) {
      const value = load<u8>(pointer);
      if (value == QUOTE) return result(pointer + 1, escaped);
      if (value < 0x20) return 0;
      if (value == BACK_SLASH) {
        escaped = true;
        pointer++;
        if (pointer >= end) return 0;
        const escape = load<u8>(pointer);
        if (escape == 0x75) {
          if (
            pointer + 5 > end ||
            !isHex(load<u8>(pointer + 1)) ||
            !isHex(load<u8>(pointer + 2)) ||
            !isHex(load<u8>(pointer + 3)) ||
            !isHex(load<u8>(pointer + 4))
          ) return 0;
          pointer += 5;
        } else {
          if (!isShortEscape(escape)) return 0;
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

  while (pointer < end) {
    const value = load<u8>(pointer);
    if (value == QUOTE) return result(pointer + 1, escaped);
    if (value < 0x20) return 0;
    if (value == BACK_SLASH) {
      escaped = true;
      pointer++;
      if (pointer >= end) return 0;
      const escape = load<u8>(pointer);
      if (escape == 0x75) {
        if (
          pointer + 5 > end ||
          !isHex(load<u8>(pointer + 1)) ||
          !isHex(load<u8>(pointer + 2)) ||
          !isHex(load<u8>(pointer + 3)) ||
          !isHex(load<u8>(pointer + 4))
        ) return 0;
        pointer += 5;
      } else {
        if (!isShortEscape(escape)) return 0;
        pointer++;
      }
      continue;
    }
    if (!trusted && value >= 0x80) {
      pointer = skipUtf8Scalar(pointer, end);
      if (pointer == 0) return 0;
    } else {
      pointer++;
    }
  }
  return 0;
}

// RFC 8259 scalar UTF-8 string scanner. This is the correctness oracle for
// optimized string kernels: bounded bytes in, retained-span result out.

const QUOTE: u8 = 0x22;
const BACKSLASH: u8 = 0x5c;

@inline
function isHex(value: u8): bool {
  return (value >= 0x30 && value <= 0x39) ||
    (value >= 0x41 && value <= 0x46) ||
    (value >= 0x61 && value <= 0x66);
}

@inline
function isShortEscape(value: u8): bool {
  return value == QUOTE || value == BACKSLASH || value == 0x2f ||
    value == 0x62 || value == 0x66 || value == 0x6e ||
    value == 0x72 || value == 0x74;
}

@inline
function isContinuation(value: u8): bool {
  return (value & 0xc0) == 0x80;
}

function skipUtf8Scalar(pointer: usize, end: usize): usize {
  const first = load<u8>(pointer);
  if (first < 0x80) return pointer + 1;
  if (first >= 0xc2 && first <= 0xdf) {
    return pointer + 2 <= end && isContinuation(load<u8>(pointer + 1))
      ? pointer + 2
      : 0;
  }
  if (first >= 0xe0 && first <= 0xef) {
    if (pointer + 3 > end) return 0;
    const second = load<u8>(pointer + 1);
    if (!isContinuation(load<u8>(pointer + 2))) return 0;
    if (first == 0xe0) return second >= 0xa0 && second <= 0xbf ? pointer + 3 : 0;
    if (first == 0xed) return second >= 0x80 && second <= 0x9f ? pointer + 3 : 0;
    return isContinuation(second) ? pointer + 3 : 0;
  }
  if (first >= 0xf0 && first <= 0xf4) {
    if (pointer + 4 > end) return 0;
    const second = load<u8>(pointer + 1);
    if (!isContinuation(load<u8>(pointer + 2)) ||
        !isContinuation(load<u8>(pointer + 3))) return 0;
    if (first == 0xf0) return second >= 0x90 && second <= 0xbf ? pointer + 4 : 0;
    if (first == 0xf4) return second >= 0x80 && second <= 0x8f ? pointer + 4 : 0;
    return isContinuation(second) ? pointer + 4 : 0;
  }
  return 0;
}

@inline
function result(next: usize, escaped: bool): u64 {
  return (<u64>next << 32) | <u64>(escaped ? 1 : 0);
}

/** Scan one quoted JSON string without packed or SIMD operations. */
export function scanString_NAIVE(
  start: usize,
  end: usize,
  trusted: bool = false,
): u64 {
  if (start >= end || load<u8>(start) != QUOTE) return 0;
  let pointer = start + 1;
  let escaped = false;

  // Host-validated UTF-8 needs only quote, escape, and control detection.
  // Keep the naive tier scalar, but amortize the loop branch across eight
  // ordered byte probes. Stopping before the first special byte preserves the
  // exact scalar escape behavior below.
  if (trusted) {
    while (pointer + 8 <= end) {
      let value = load<u8>(pointer);
      if (value == QUOTE || value == BACKSLASH || value < 0x20) break;
      value = load<u8>(pointer + 1);
      if (value == QUOTE || value == BACKSLASH || value < 0x20) {
        pointer += 1;
        break;
      }
      value = load<u8>(pointer + 2);
      if (value == QUOTE || value == BACKSLASH || value < 0x20) {
        pointer += 2;
        break;
      }
      value = load<u8>(pointer + 3);
      if (value == QUOTE || value == BACKSLASH || value < 0x20) {
        pointer += 3;
        break;
      }
      value = load<u8>(pointer + 4);
      if (value == QUOTE || value == BACKSLASH || value < 0x20) {
        pointer += 4;
        break;
      }
      value = load<u8>(pointer + 5);
      if (value == QUOTE || value == BACKSLASH || value < 0x20) {
        pointer += 5;
        break;
      }
      value = load<u8>(pointer + 6);
      if (value == QUOTE || value == BACKSLASH || value < 0x20) {
        pointer += 6;
        break;
      }
      value = load<u8>(pointer + 7);
      if (value == QUOTE || value == BACKSLASH || value < 0x20) {
        pointer += 7;
        break;
      }
      pointer += 8;
    }
  }

  while (pointer < end) {
    const value = load<u8>(pointer);
    if (value == QUOTE) return result(pointer + 1, escaped);
    if (value < 0x20) return 0;
    if (value == BACKSLASH) {
      escaped = true;
      pointer++;
      if (pointer >= end) return 0;
      const escape = load<u8>(pointer);
      if (escape == 0x75) {
        if (pointer + 5 > end ||
            !isHex(load<u8>(pointer + 1)) ||
            !isHex(load<u8>(pointer + 2)) ||
            !isHex(load<u8>(pointer + 3)) ||
            !isHex(load<u8>(pointer + 4))) return 0;
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

// Raw UTF-8 parsing primitives shared by generated schema parsers.

import { eiselLemire22 } from "../eisel-lemire";
import { parse4Digits } from "./digits";


@external("env", "parseNumberSlow")
declare function parseNumberSlow(pointer: u32, length: u32): f64;

export const ERROR_UNEXPECTED_TOKEN: u32 = 16;
export const ERROR_UNTERMINATED_STRING: u32 = 17;
export const ERROR_INVALID_ESCAPE: u32 = 18;
export const ERROR_INVALID_NUMBER: u32 = 19;
export const ERROR_TRAILING_DATA: u32 = 20;

const QUOTE: u8 = 0x22;
const BACKSLASH: u8 = 0x5c;
const LBRACE: u8 = 0x7b;
const RBRACE: u8 = 0x7d;
const LBRACKET: u8 = 0x5b;
const RBRACKET: u8 = 0x5d;

let stringEscaped: bool = false;
let stringInputTrusted: bool = false;
let inputMinified: bool = true;


// JavaScript string ingress is encoded by the host and is therefore already
// shortest-form UTF-8. Raw Buffer/Uint8Array ingress keeps the strict validator.
export function setStringInputTrusted(trusted: bool): void {
  stringInputTrusted = trusted;
  inputMinified = true;
}


@inline
export function inputWasMinified(): bool {
  return inputMinified;
}


@inline
export function align8(value: usize): usize {
  return (value + 7) & ~(<usize>7);
}


@inline
export function isWhitespace(value: u8): bool {
  return value == 0x20 || value == 0x09 || value == 0x0a || value == 0x0d;
}


@inline
export function skipWhitespace(pointer: usize, end: usize): usize {
  const start = pointer;
  while (pointer < end && isWhitespace(load<u8>(pointer))) pointer++;
  if (pointer != start) inputMinified = false;
  return pointer;
}


@inline
function isHex(value: u8): bool {
  return (value >= 0x30 && value <= 0x39) || (value >= 0x41 && value <= 0x46) || (value >= 0x61 && value <= 0x66);
}


@inline
function validShortEscape(value: u8): bool {
  return value == QUOTE || value == BACKSLASH || value == 0x2f || value == 0x62 || value == 0x66 || value == 0x6e || value == 0x72 || value == 0x74;
}

@inline
function hexNibble(value: u8): u32 {
  if (value >= 0x30 && value <= 0x39) return value - 0x30;
  if (value >= 0x41 && value <= 0x46) return value - 0x37;
  return value - 0x57;
}

@inline
function decodeHex4(pointer: usize): u32 {
  return (hexNibble(load<u8>(pointer)) << 12) |
    (hexNibble(load<u8>(pointer + 1)) << 8) |
    (hexNibble(load<u8>(pointer + 2)) << 4) |
    hexNibble(load<u8>(pointer + 3));
}

// Cold exact matcher for escaped object keys. Generated code first compares
// canonical raw UTF-8 bytes with packed/SIMD loads; this handles alternative
// legal spellings such as "na\u006de" without allocating or decoding a string.
export function matchJsonKey(pointer: usize, end: usize, expected: usize, expectedLength: u32): bool {
  const expectedEnd = expected + expectedLength;
  while (pointer < end) {
    let value = load<u8>(pointer++);
    if (value != BACKSLASH) {
      if (expected >= expectedEnd || load<u8>(expected++) != value) return false;
      continue;
    }
    if (pointer >= end) return false;
    const escape = load<u8>(pointer++);
    if (escape != 0x75) {
      value = escape == 0x62 ? 0x08 : escape == 0x66 ? 0x0c : escape == 0x6e ? 0x0a : escape == 0x72 ? 0x0d : escape == 0x74 ? 0x09 : escape;
      if (expected >= expectedEnd || load<u8>(expected++) != value) return false;
      continue;
    }
    if (pointer + 4 > end) return false;
    let scalar = decodeHex4(pointer);
    pointer += 4;
    if (scalar >= 0xd800 && scalar <= 0xdbff && pointer + 6 <= end && load<u8>(pointer) == BACKSLASH && load<u8>(pointer + 1) == 0x75) {
      const low = decodeHex4(pointer + 2);
      if (low >= 0xdc00 && low <= 0xdfff) {
        scalar = 0x10000 + ((scalar - 0xd800) << 10) + (low - 0xdc00);
        pointer += 6;
      } else scalar = 0xfffd;
    } else if (scalar >= 0xd800 && scalar <= 0xdfff) scalar = 0xfffd;

    if (scalar < 0x80) {
      if (expected >= expectedEnd || load<u8>(expected++) != <u8>scalar) return false;
    } else if (scalar < 0x800) {
      if (expected + 2 > expectedEnd || load<u8>(expected) != <u8>(0xc0 | (scalar >> 6)) || load<u8>(expected + 1) != <u8>(0x80 | (scalar & 0x3f))) return false;
      expected += 2;
    } else if (scalar < 0x10000) {
      if (expected + 3 > expectedEnd || load<u8>(expected) != <u8>(0xe0 | (scalar >> 12)) || load<u8>(expected + 1) != <u8>(0x80 | ((scalar >> 6) & 0x3f)) || load<u8>(expected + 2) != <u8>(0x80 | (scalar & 0x3f))) return false;
      expected += 3;
    } else {
      if (expected + 4 > expectedEnd || load<u8>(expected) != <u8>(0xf0 | (scalar >> 18)) || load<u8>(expected + 1) != <u8>(0x80 | ((scalar >> 12) & 0x3f)) || load<u8>(expected + 2) != <u8>(0x80 | ((scalar >> 6) & 0x3f)) || load<u8>(expected + 3) != <u8>(0x80 | (scalar & 0x3f))) return false;
      expected += 4;
    }
  }
  return expected == expectedEnd;
}


@inline
function isContinuation(value: u8): bool {
  return (value & 0xc0) == 0x80;
}

// Validates one shortest-form Unicode scalar encoded as UTF-8 and returns the
// next pointer. Surrogates, overlong forms, and values above U+10FFFF fail.
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
    if (first == 0xe0 ? second < 0xa0 || second > 0xbf : first == 0xed ? second < 0x80 || second > 0x9f : !isContinuation(second)) return 0;
    return pointer + 3;
  }
  if (first >= 0xf0 && first <= 0xf4) {
    if (pointer + 4 > end) return 0;
    const second = load<u8>(pointer + 1);
    if (first == 0xf0 ? second < 0x90 || second > 0xbf : first == 0xf4 ? second < 0x80 || second > 0x8f : !isContinuation(second)) return 0;
    if (!isContinuation(load<u8>(pointer + 2)) || !isContinuation(load<u8>(pointer + 3))) return 0;
    return pointer + 4;
  }
  return 0;
}


@inline
function hasZeroByte(word: u64): u64 {
  return (word - 0x0101010101010101) & ~word & 0x8080808080808080;
}


@inline
function swarStringSpecial(word: u64): bool {
  return hasZeroByte(word ^ 0x2222222222222222) != 0 || hasZeroByte(word ^ 0x5c5c5c5c5c5c5c5c) != 0 || hasZeroByte(word & 0xe0e0e0e0e0e0e0e0) != 0 || (word & 0x8080808080808080) != 0;
}

// Trusted host-string scanner. It retains JSON quote, escape, and raw-control
// validation but does not revalidate UTF-8 continuation bytes scalar-by-scalar.
// This is the raw UTF-8 analogue of json-as's trusted generated string field.
function scanStringContentTrusted(pointer: usize, end: usize): usize {
  stringEscaped = false;
  while (pointer < end) {
    if (ASC_FEATURE_SIMD) {
      while (pointer + 16 <= end) {
        const block = v128.load(pointer);
        const quote = i8x16.eq(block, i8x16.splat(QUOTE));
        const slash = i8x16.eq(block, i8x16.splat(BACKSLASH));
        const controls = i8x16.lt_u(block, i8x16.splat(0x20));
        const mask = i8x16.bitmask(v128.or(v128.or(quote, slash), controls));
        if (mask != 0) {
          pointer += <usize>ctz(mask);
          break;
        }
        pointer += 16;
      }
    }
    while (pointer + 8 <= end) {
      const word = load<u64>(pointer);
      const mask = hasZeroByte(word ^ 0x2222222222222222) | hasZeroByte(word ^ 0x5c5c5c5c5c5c5c5c) | hasZeroByte(word & 0xe0e0e0e0e0e0e0e0);
      if (mask != 0) {
        pointer += <usize>(ctz(mask) >> 3);
        break;
      }
      pointer += 8;
    }

    while (pointer < end) {
      const value = load<u8>(pointer);
      if (value == QUOTE) return pointer;
      if (value < 0x20) return 0;
      if (value != BACKSLASH) {
        pointer++;
        continue;
      }

      stringEscaped = true;
      pointer++;
      if (pointer >= end) return 0;
      const escape = load<u8>(pointer);
      if (escape == 0x75) {
        if (pointer + 4 >= end) return 0;
        if (!isHex(load<u8>(pointer + 1)) || !isHex(load<u8>(pointer + 2)) || !isHex(load<u8>(pointer + 3)) || !isHex(load<u8>(pointer + 4))) return 0;
        pointer += 5;
      } else {
        if (!validShortEscape(escape)) return 0;
        pointer++;
      }
      break;
    }
  }
  return 0;
}


// Returns the pointer to the terminating quote, or zero on failure.
function scanStringContentStrict(pointer: usize, end: usize): usize {
  stringEscaped = false;
  while (pointer < end) {
    if (ASC_FEATURE_SIMD) {
      while (pointer + 16 <= end) {
        const block = v128.load(pointer);
        const quote = i8x16.eq(block, i8x16.splat(QUOTE));
        const slash = i8x16.eq(block, i8x16.splat(BACKSLASH));
        const controls = i8x16.lt_u(block, i8x16.splat(0x20));
        const nonAscii = i8x16.lt_s(block, i8x16.splat(0));
        const mask = i8x16.bitmask(v128.or(v128.or(v128.or(quote, slash), controls), nonAscii));
        if (mask != 0) {
          pointer += <usize>ctz(mask);
          break;
        }
        pointer += 16;
      }
    }
    // Scalar-compatible Wasm and SIMD tails share an 8-byte SWAR classifier,
    // then the same bounded scalar validator for candidates and tails.
    while (pointer + 8 <= end) {
      const word = load<u64>(pointer);
      const mask = hasZeroByte(word ^ 0x2222222222222222) | hasZeroByte(word ^ 0x5c5c5c5c5c5c5c5c) | hasZeroByte(word & 0xe0e0e0e0e0e0e0e0) | (word & 0x8080808080808080);
      if (mask != 0) {
        pointer += <usize>(ctz(mask) >> 3);
        break;
      }
      pointer += 8;
    }

    while (pointer < end) {
      const value = load<u8>(pointer);
      if (value == QUOTE) return pointer;
      if (value < 0x20) return 0;
      if (value != BACKSLASH) {
        if (value < 0x80) pointer++;
        else {
          pointer = skipUtf8Scalar(pointer, end);
          if (pointer == 0) return 0;
        }
        continue;
      }

      stringEscaped = true;
      pointer++;
      if (pointer >= end) return 0;
      const escape = load<u8>(pointer);
      if (escape == 0x75) {
        if (pointer + 4 >= end) return 0;
        if (!isHex(load<u8>(pointer + 1)) || !isHex(load<u8>(pointer + 2)) || !isHex(load<u8>(pointer + 3)) || !isHex(load<u8>(pointer + 4))) return 0;
        pointer += 5;
      } else {
        if (!validShortEscape(escape)) return 0;
        pointer++;
      }
      break;
    }
  }
  return 0;
}


export function scanStringContent(pointer: usize, end: usize): usize {
  return stringInputTrusted ? scanStringContentTrusted(pointer, end) : scanStringContentStrict(pointer, end);
}


@inline
export function lastStringHadEscape(): bool {
  return stringEscaped;
}


@inline
function isDigit(value: u8): bool {
  return value >= 0x30 && value <= 0x39;
}


@inline
function smallPowerOfTen(exponent: i32): f64 {
  switch (exponent) {
    case 0:
      return 1.0;
    case 1:
      return 1e1;
    case 2:
      return 1e2;
    case 3:
      return 1e3;
    case 4:
      return 1e4;
    case 5:
      return 1e5;
    case 6:
      return 1e6;
    case 7:
      return 1e7;
    case 8:
      return 1e8;
    case 9:
      return 1e9;
    case 10:
      return 1e10;
    case 11:
      return 1e11;
    case 12:
      return 1e12;
    case 13:
      return 1e13;
    case 14:
      return 1e14;
    case 15:
      return 1e15;
    case 16:
      return 1e16;
    case 17:
      return 1e17;
    case 18:
      return 1e18;
    case 19:
      return 1e19;
    case 20:
      return 1e20;
    case 21:
      return 1e21;
    case 22:
      return 1e22;
    default:
      return 0.0;
  }
}

// Validates and parses one JSON number into destination, returning its end.
// The common path accumulates an exact u64 significand, the 19-digit bounded
// path uses Eisel-Lemire, and ambiguous long/wide values use the raw host ABI.
export function parseNumber(pointer: usize, end: usize, destination: usize): usize {
  const start = pointer;
  let negative = false;
  if (pointer < end && load<u8>(pointer) == 0x2d) {
    negative = true;
    pointer++;
  }
  if (pointer >= end) return 0;

  let mantissa: u64 = 0;
  let mantissaDigits = 0;
  let discardedDigits = 0;
  let significant = false;
  let value = load<u8>(pointer);
  if (value == 0x30) {
    pointer++;
    if (pointer < end && isDigit(load<u8>(pointer))) return 0;
  } else {
    if (value < 0x31 || value > 0x39) return 0;
    significant = true;
    mantissa = value - 0x30;
    mantissaDigits = 1;
    pointer++;
    while (pointer < end && isDigit(load<u8>(pointer))) {
      // Keep the integer prefix scalar. As in json-as, typical JSON integer
      // parts are only one to three digits; probing a packed stride at their
      // delimiter costs more than it saves. Packed folding starts in long
      // fractional runs below, where four successful lanes are common.
      const digit = <u32>(load<u8>(pointer) - 0x30);
      if (mantissaDigits < 19) {
        mantissa = mantissa * 10 + digit;
        mantissaDigits++;
      } else {
        discardedDigits++;
      }
      pointer++;
    }
  }

  let fractionalDigits = 0;
  if (pointer < end && load<u8>(pointer) == 0x2e) {
    pointer++;
    if (pointer >= end || !isDigit(load<u8>(pointer))) return 0;
    while (pointer < end && isDigit(load<u8>(pointer))) {
      if (significant && mantissaDigits <= 15 && pointer + 4 <= end) {
        const packed = parse4Digits(load<u32>(pointer));
        if (packed != U32.MAX_VALUE) {
          mantissa = mantissa * 10_000 + packed;
          mantissaDigits += 4;
          fractionalDigits += 4;
          pointer += 4;
          continue;
        }
      }
      const digit = <u32>(load<u8>(pointer) - 0x30);
      significant = significant || digit != 0;
      if (significant) {
        if (mantissaDigits < 19) {
          mantissa = mantissa * 10 + digit;
          mantissaDigits++;
        } else {
          discardedDigits++;
        }
      }
      fractionalDigits++;
      pointer++;
    }
  }

  let exponent = 0;
  if (pointer < end) {
    value = load<u8>(pointer);
    if (value == 0x65 || value == 0x45) {
      pointer++;
      let exponentNegative = false;
      if (pointer < end) {
        value = load<u8>(pointer);
        if (value == 0x2b) pointer++;
        else if (value == 0x2d) {
          exponentNegative = true;
          pointer++;
        }
      }
      if (pointer >= end || !isDigit(load<u8>(pointer))) return 0;
      while (pointer < end && isDigit(load<u8>(pointer))) {
        if (exponent < 10000) exponent = exponent * 10 + <i32>(load<u8>(pointer) - 0x30);
        pointer++;
      }
      if (exponentNegative) exponent = -exponent;
    }
  }

  if (pointer == start) return 0;
  let scale = exponent - fractionalDigits + discardedDigits;
  let result: f64;
  if (discardedDigits != 0 || scale < -22 || scale > 22 || (mantissa > 9007199254740992 && (scale < -22 || scale > 22))) {
    const unsignedStart = negative ? start + 1 : start;
    result = parseNumberSlow(<u32>unsignedStart, <u32>(pointer - unsignedStart));
    // The grammar was already validated, so NaN means the host import is not
    // behaving according to its ABI contract.
    if (result != result) return 0;
  } else if (mantissa <= 9007199254740992) {
    result = <f64>mantissa;
    if (scale > 0) result *= smallPowerOfTen(scale);
    else if (scale < 0) result /= smallPowerOfTen(-scale);
  } else {
    result = eiselLemire22(mantissa, scale);
  }
  if (negative) result = -result;
  if (destination != 0) store<f64>(destination, result);
  return pointer;
}

// Grammar-only number scanner for skipped values and container count passes.
// It deliberately does not accumulate a mantissa or call the slow-number host
// import: the materializing pass will perform conversion exactly once.
function skipNumber(pointer: usize, end: usize): usize {
  if (pointer < end && load<u8>(pointer) == 0x2d) pointer++;
  if (pointer >= end) return 0;
  let value = load<u8>(pointer);
  if (value == 0x30) {
    pointer++;
    if (pointer < end && isDigit(load<u8>(pointer))) return 0;
  } else {
    if (value < 0x31 || value > 0x39) return 0;
    do pointer++;
    while (pointer < end && isDigit(load<u8>(pointer)));
  }
  if (pointer < end && load<u8>(pointer) == 0x2e) {
    pointer++;
    if (pointer >= end || !isDigit(load<u8>(pointer))) return 0;
    do pointer++;
    while (pointer < end && isDigit(load<u8>(pointer)));
  }
  if (pointer < end) {
    value = load<u8>(pointer);
    if (value == 0x65 || value == 0x45) {
      pointer++;
      if (pointer < end) {
        value = load<u8>(pointer);
        if (value == 0x2b || value == 0x2d) pointer++;
      }
      if (pointer >= end || !isDigit(load<u8>(pointer))) return 0;
      do pointer++;
      while (pointer < end && isDigit(load<u8>(pointer)));
    }
  }
  return pointer;
}

function skipValueAtDepth(pointer: usize, end: usize, depth: u32): usize {
  if (depth > 256) return 0;
  pointer = skipWhitespace(pointer, end);
  if (pointer >= end) return 0;
  const first = load<u8>(pointer);
  if (first == QUOTE) {
    const quote = scanStringContent(pointer + 1, end);
    return quote == 0 ? 0 : quote + 1;
  }
  if (first == LBRACKET) {
    pointer = skipWhitespace(pointer + 1, end);
    if (pointer < end && load<u8>(pointer) == RBRACKET) return pointer + 1;
    while (pointer < end) {
      pointer = skipValueAtDepth(pointer, end, depth + 1);
      if (pointer == 0) return 0;
      pointer = skipWhitespace(pointer, end);
      if (pointer >= end) return 0;
      const separator = load<u8>(pointer);
      if (separator == RBRACKET) return pointer + 1;
      if (separator != 0x2c) return 0;
      pointer = skipWhitespace(pointer + 1, end);
      if (pointer >= end || load<u8>(pointer) == RBRACKET) return 0;
    }
    return 0;
  }
  if (first == LBRACE) {
    pointer = skipWhitespace(pointer + 1, end);
    if (pointer < end && load<u8>(pointer) == RBRACE) return pointer + 1;
    while (pointer < end) {
      if (load<u8>(pointer) != QUOTE) return 0;
      const keyEnd = scanStringContent(pointer + 1, end);
      if (keyEnd == 0) return 0;
      pointer = skipWhitespace(keyEnd + 1, end);
      if (pointer >= end || load<u8>(pointer) != 0x3a) return 0;
      pointer = skipValueAtDepth(pointer + 1, end, depth + 1);
      if (pointer == 0) return 0;
      pointer = skipWhitespace(pointer, end);
      if (pointer >= end) return 0;
      const separator = load<u8>(pointer);
      if (separator == RBRACE) return pointer + 1;
      if (separator != 0x2c) return 0;
      pointer = skipWhitespace(pointer + 1, end);
      if (pointer >= end || load<u8>(pointer) == RBRACE) return 0;
    }
    return 0;
  }
  if (first == 0x74 && pointer + 4 <= end && load<u32>(pointer) == 0x65757274) return pointer + 4;
  if (first == 0x6e && pointer + 4 <= end && load<u32>(pointer) == 0x6c6c756e) return pointer + 4;
  if (first == 0x66 && pointer + 5 <= end && load<u32>(pointer) == 0x736c6166 && load<u8>(pointer + 4) == 0x65) return pointer + 5;

  return skipNumber(pointer, end);
}

export function skipValue(pointer: usize, end: usize): usize {
  return skipValueAtDepth(pointer, end, 0);
}

// Exact-minified counterpart used by generated ordered parsers. Keeping this
// path separate removes the whitespace probes around every nested value in
// JSON.stringify-shaped input. A zero result is deliberately retried by the
// fully validating scanner so pretty-printed values still parse correctly and
// update inputMinified through skipWhitespace.
function skipValueMinifiedAtDepth(pointer: usize, end: usize, depth: u32): usize {
  if (depth > 256 || pointer >= end) return 0;
  const first = load<u8>(pointer);
  if (first == QUOTE) {
    const quote = scanStringContent(pointer + 1, end);
    return quote == 0 ? 0 : quote + 1;
  }
  if (first == LBRACKET) {
    pointer++;
    if (pointer < end && load<u8>(pointer) == RBRACKET) return pointer + 1;
    while (pointer < end) {
      pointer = skipValueMinifiedAtDepth(pointer, end, depth + 1);
      if (pointer == 0 || pointer >= end) return 0;
      const separator = load<u8>(pointer);
      if (separator == RBRACKET) return pointer + 1;
      if (separator != 0x2c || pointer + 1 >= end || load<u8>(pointer + 1) == RBRACKET) return 0;
      pointer++;
    }
    return 0;
  }
  if (first == LBRACE) {
    pointer++;
    if (pointer < end && load<u8>(pointer) == RBRACE) return pointer + 1;
    while (pointer < end) {
      if (load<u8>(pointer) != QUOTE) return 0;
      const keyEnd = scanStringContent(pointer + 1, end);
      if (keyEnd == 0 || keyEnd + 1 >= end || load<u8>(keyEnd + 1) != 0x3a) return 0;
      pointer = skipValueMinifiedAtDepth(keyEnd + 2, end, depth + 1);
      if (pointer == 0 || pointer >= end) return 0;
      const separator = load<u8>(pointer);
      if (separator == RBRACE) return pointer + 1;
      if (separator != 0x2c || pointer + 1 >= end || load<u8>(pointer + 1) == RBRACE) return 0;
      pointer++;
    }
    return 0;
  }
  if (first == 0x74 && pointer + 4 <= end && load<u32>(pointer) == 0x65757274) return pointer + 4;
  if (first == 0x6e && pointer + 4 <= end && load<u32>(pointer) == 0x6c6c756e) return pointer + 4;
  if (first == 0x66 && pointer + 5 <= end && load<u32>(pointer) == 0x736c6166 && load<u8>(pointer + 4) == 0x65) return pointer + 5;
  return skipNumber(pointer, end);
}

export function skipValueMinified(pointer: usize, end: usize): usize {
  const next = skipValueMinifiedAtDepth(pointer, end, 0);
  return next == 0 ? skipValueAtDepth(pointer, end, 0) : next;
}

// Returns `(endPointer << 32) | elementCount`, or zero for an invalid array.
// The generated typed array parser uses this validation/count pass to allocate
// one exact contiguous element region before materializing nested values.
export function countArrayElements(pointer: usize, end: usize): u64 {
  pointer = skipWhitespace(pointer, end);
  if (pointer >= end || load<u8>(pointer) != LBRACKET) return 0;
  pointer = skipWhitespace(pointer + 1, end);
  let count: u32 = 0;
  if (pointer < end && load<u8>(pointer) == RBRACKET) {
    return (<u64>(pointer + 1)) << 32;
  }
  while (pointer < end) {
    const next = skipValueAtDepth(pointer, end, 1);
    if (next == 0) return 0;
    count++;
    pointer = skipWhitespace(next, end);
    if (pointer >= end) return 0;
    const separator = load<u8>(pointer);
    if (separator == RBRACKET) return ((<u64>(pointer + 1)) << 32) | count;
    if (separator != 0x2c) return 0;
    pointer = skipWhitespace(pointer + 1, end);
    if (pointer >= end || load<u8>(pointer) == RBRACKET) return 0;
  }
  return 0;
}

// Returns `(endPointer << 32) | memberCount`, or zero for an invalid object.
export function countObjectMembers(pointer: usize, end: usize): u64 {
  pointer = skipWhitespace(pointer, end);
  if (pointer >= end || load<u8>(pointer) != LBRACE) return 0;
  pointer = skipWhitespace(pointer + 1, end);
  let count: u32 = 0;
  if (pointer < end && load<u8>(pointer) == RBRACE) {
    return (<u64>(pointer + 1)) << 32;
  }
  while (pointer < end) {
    if (load<u8>(pointer) != QUOTE) return 0;
    const keyEnd = scanStringContent(pointer + 1, end);
    if (keyEnd == 0) return 0;
    pointer = skipWhitespace(keyEnd + 1, end);
    if (pointer >= end || load<u8>(pointer) != 0x3a) return 0;
    pointer = skipValueAtDepth(pointer + 1, end, 1);
    if (pointer == 0) return 0;
    count++;
    pointer = skipWhitespace(pointer, end);
    if (pointer >= end) return 0;
    const separator = load<u8>(pointer);
    if (separator == RBRACE) return ((<u64>(pointer + 1)) << 32) | count;
    if (separator != 0x2c) return 0;
    pointer = skipWhitespace(pointer + 1, end);
    if (pointer >= end || load<u8>(pointer) == RBRACE) return 0;
  }
  return 0;
}

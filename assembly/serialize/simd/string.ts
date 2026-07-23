import { claimWriter } from "../writer";
import { u16_to_hex4_swar } from "../../util/swar";

const BACKSLASH: u8 = 0x5c;


@inline
function backslashMask(pointer: usize): i32 {
  return i8x16.bitmask(i8x16.eq(v128.load(pointer), i8x16.splat(BACKSLASH)));
}


@inline
function hexNibble(value: u8): u32 {
  if (value >= 0x30 && value <= 0x39) return value - 0x30;
  return (value | 0x20) - 0x61 + 10;
}


@inline
function decodeHex4(pointer: usize): u32 {
  return (hexNibble(load<u8>(pointer)) << 12) | (hexNibble(load<u8>(pointer + 1)) << 8) | (hexNibble(load<u8>(pointer + 2)) << 4) | hexNibble(load<u8>(pointer + 3));
}


@inline
function escapedLength(value: u8): u32 {
  if (value == 0x22 || value == 0x5c) return 2;
  if (value == 0x08 || value == 0x09 || value == 0x0a || value == 0x0c || value == 0x0d) return 2;
  return value < 0x20 ? 6 : 1;
}


@inline
function utf8Length(code: u32): u32 {
  return code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
}


@inline
function shortEscape(value: u8): u8 {
  if (value == 0x08) return 0x62;
  if (value == 0x09) return 0x74;
  if (value == 0x0a) return 0x6e;
  if (value == 0x0c) return 0x66;
  return 0x72;
}


@inline
function writeEscapedByte(destination: usize, value: u8): usize {
  if (value == 0x22 || value == 0x5c) {
    store<u8>(destination, BACKSLASH);
    store<u8>(destination + 1, value);
    return destination + 2;
  }
  if (value == 0x08 || value == 0x09 || value == 0x0a || value == 0x0c || value == 0x0d) {
    store<u8>(destination, BACKSLASH);
    store<u8>(destination + 1, shortEscape(value));
    return destination + 2;
  }
  if (value < 0x20) {
    store<u32>(destination, 0x3030_755c);
    const high = value >> 4;
    const low = value & 0x0f;
    store<u8>(destination + 4, <u8>(high < 10 ? 0x30 + high : 0x57 + high));
    store<u8>(destination + 5, <u8>(low < 10 ? 0x30 + low : 0x57 + low));
    return destination + 6;
  }
  store<u8>(destination, value);
  return destination + 1;
}

function writeScalar(destination: usize, code: u32): usize {
  if (code <= 0x7f) return writeEscapedByte(destination, <u8>code);
  if (code <= 0x7ff) {
    store<u8>(destination, <u8>(0xc0 | (code >> 6)));
    store<u8>(destination + 1, <u8>(0x80 | (code & 0x3f)));
    return destination + 2;
  }
  if (code <= 0xffff) {
    store<u8>(destination, <u8>(0xe0 | (code >> 12)));
    store<u8>(destination + 1, <u8>(0x80 | ((code >> 6) & 0x3f)));
    store<u8>(destination + 2, <u8>(0x80 | (code & 0x3f)));
    return destination + 3;
  }
  store<u8>(destination, <u8>(0xf0 | (code >> 18)));
  store<u8>(destination + 1, <u8>(0x80 | ((code >> 12) & 0x3f)));
  store<u8>(destination + 2, <u8>(0x80 | ((code >> 6) & 0x3f)));
  store<u8>(destination + 3, <u8>(0x80 | (code & 0x3f)));
  return destination + 4;
}


@inline
function writeSurrogateEscape(destination: usize, code: u32): usize {
  store<u16>(destination, 0x755c);
  store<u32>(destination + 2, u16_to_hex4_swar(<u16>code));
  return destination + 6;
}

/** Copy a validated retained payload without re-scanning it. */
export function serializeRetainedCleanString_SIMD(source: usize, length: u32): bool {
  if (length > U32.MAX_VALUE - 2) return false;
  const destination = claimWriter(length + 2);
  if (destination == 0) return false;
  store<u8>(destination, 0x22);
  memory.copy(destination + 1, source, length);
  store<u8>(destination + 1 + <usize>length, 0x22);
  return true;
}

/**
 * Canonicalize a validated escaped payload. SIMD skips 16-byte clean runs in
 * both the exact-size and write passes; only escape candidates go scalar.
 */
export function serializeRetainedEscapedString_SIMD(source: usize, length: u32): bool {
  const end = source + <usize>length;
  let pointer = source;
  let required: u64 = 2;

  while (pointer < end) {
    while (end - pointer >= 16) {
      const mask = backslashMask(pointer);
      if (mask != 0) {
        const clean = <usize>ctz(mask);
        required += clean;
        pointer += clean;
        break;
      }
      pointer += 16;
      required += 16;
    }
    while (pointer < end && load<u8>(pointer) != BACKSLASH) {
      pointer++;
      required++;
    }
    if (pointer == end) break;

    pointer++;
    const escape = load<u8>(pointer++);
    let code: u32;
    if (escape == 0x75) {
      code = decodeHex4(pointer);
      pointer += 4;
      if (code >= 0xd800 && code <= 0xdbff && end - pointer >= 6 && load<u8>(pointer) == BACKSLASH && load<u8>(pointer + 1) == 0x75) {
        const low = decodeHex4(pointer + 2);
        if (low >= 0xdc00 && low <= 0xdfff) {
          pointer += 6;
          code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
        }
      }
    } else if (escape == 0x22 || escape == BACKSLASH || escape == 0x2f) {
      code = escape;
    } else if (escape == 0x62) code = 0x08;
    else if (escape == 0x66) code = 0x0c;
    else if (escape == 0x6e) code = 0x0a;
    else if (escape == 0x72) code = 0x0d;
    else code = 0x09;

    required += code >= 0xd800 && code <= 0xdfff ? 6 : code < 0x20 || code == 0x22 || code == BACKSLASH ? escapedLength(<u8>code) : utf8Length(code);
  }

  if (required > U32.MAX_VALUE) return false;
  const destination = claimWriter(<u32>required);
  if (destination == 0) return false;

  pointer = source;
  let output = destination;
  store<u8>(output++, 0x22);
  while (pointer < end) {
    const run = pointer;
    while (end - pointer >= 16) {
      const mask = backslashMask(pointer);
      if (mask != 0) {
        pointer += <usize>ctz(mask);
        break;
      }
      pointer += 16;
    }
    while (pointer < end && load<u8>(pointer) != BACKSLASH) pointer++;
    if (pointer > run) {
      const clean = pointer - run;
      memory.copy(output, run, clean);
      output += clean;
    }
    if (pointer == end) break;

    pointer++;
    const escape = load<u8>(pointer++);
    let code: u32;
    if (escape == 0x75) {
      code = decodeHex4(pointer);
      pointer += 4;
      if (code >= 0xd800 && code <= 0xdbff && end - pointer >= 6 && load<u8>(pointer) == BACKSLASH && load<u8>(pointer + 1) == 0x75) {
        const low = decodeHex4(pointer + 2);
        if (low >= 0xdc00 && low <= 0xdfff) {
          pointer += 6;
          code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
        }
      }
    } else if (escape == 0x22 || escape == BACKSLASH || escape == 0x2f) {
      code = escape;
    } else if (escape == 0x62) code = 0x08;
    else if (escape == 0x66) code = 0x0c;
    else if (escape == 0x6e) code = 0x0a;
    else if (escape == 0x72) code = 0x0d;
    else code = 0x09;

    output = code >= 0xd800 && code <= 0xdfff ? writeSurrogateEscape(output, code) : writeScalar(output, code);
  }
  store<u8>(output, 0x22);
  return true;
}

import { claimWriter } from "../writer";
import { u16_to_hex4_swar } from "../../util/swar";

const ONES: u64 = 0x0101_0101_0101_0101;
const HIGH: u64 = 0x8080_8080_8080_8080;
const QUOTES: u64 = 0x2222_2222_2222_2222;
const SLASHES: u64 = 0x5c5c_5c5c_5c5c_5c5c;
const CONTROL_BITS: u64 = 0xe0e0_e0e0_e0e0_e0e0;

@inline
function zeroByteCandidates(value: u64): u64 {
  return (value - ONES) & ~value & HIGH;
}

/**
 * Candidate mask for JSON-escapable UTF-8 bytes. Candidates
 * are confirmed scalarly; borrow propagation may over-report a later lane.
 */
@inline
export function detect_escapable_u64_swar_safe(block: u64): u64 {
  return zeroByteCandidates(block ^ QUOTES) |
    zeroByteCandidates(block ^ SLASHES) |
    zeroByteCandidates(block & CONTROL_BITS);
}

@inline
function escapedLength(value: u8): u32 {
  if (value == 0x22 || value == 0x5c) return 2;
  if (
    value == 0x08 ||
    value == 0x09 ||
    value == 0x0a ||
    value == 0x0c ||
    value == 0x0d
  ) return 2;
  return value < 0x20 ? 6 : 1;
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
    store<u8>(destination, 0x5c);
    store<u8>(destination + 1, value);
    return destination + 2;
  }
  if (
    value == 0x08 ||
    value == 0x09 ||
    value == 0x0a ||
    value == 0x0c ||
    value == 0x0d
  ) {
    store<u8>(destination, 0x5c);
    store<u8>(destination + 1, shortEscape(value));
    return destination + 2;
  }
  if (value < 0x20) {
    store<u32>(destination, 0x3030_755c); // "\u00"
    const high = value >> 4;
    const low = value & 0x0f;
    store<u8>(destination + 4, <u8>(high < 10 ? 0x30 + high : 0x57 + high));
    store<u8>(destination + 5, <u8>(low < 10 ? 0x30 + low : 0x57 + low));
    return destination + 6;
  }
  store<u8>(destination, value);
  return destination + 1;
}

function measureUtf8(source: usize, length: u32): u32 {
  const end = source + <usize>length;
  let pointer = source;
  let required: u64 = 2;
  let consecutiveSpecial: u32 = 0;
  while (end - pointer >= 8) {
    const block = load<u64>(pointer);
    if (detect_escapable_u64_swar_safe(block) == 0) {
      consecutiveSpecial = 0;
      required += 8;
      pointer += 8;
      continue;
    }
    const blockEnd = pointer + 8;
    while (pointer < blockEnd) {
      required += escapedLength(load<u8>(pointer++));
    }
    consecutiveSpecial++;
    if (consecutiveSpecial >= 2) {
      while (pointer < end) required += escapedLength(load<u8>(pointer++));
      return required > U32.MAX_VALUE ? 0 : <u32>required;
    }
  }
  while (pointer < end) required += escapedLength(load<u8>(pointer++));
  return required > U32.MAX_VALUE ? 0 : <u32>required;
}

function writeUtf8(
  source: usize,
  length: u32,
  destination: usize,
): void {
  const end = source + <usize>length;
  let pointer = source;
  let output = destination;
  let consecutiveSpecial: u32 = 0;
  store<u8>(output++, 0x22);

  while (end - pointer >= 8) {
    const block = load<u64>(pointer);
    if (detect_escapable_u64_swar_safe(block) == 0) {
      consecutiveSpecial = 0;
      store<u64>(output, block);
      output += 8;
      pointer += 8;
      continue;
    }
    const blockEnd = pointer + 8;
    while (pointer < blockEnd) {
      output = writeEscapedByte(output, load<u8>(pointer++));
    }
    consecutiveSpecial++;
    if (consecutiveSpecial >= 2) {
      while (pointer < end) {
        output = writeEscapedByte(output, load<u8>(pointer++));
      }
      store<u8>(output, 0x22);
      return;
    }
  }
  while (pointer < end) {
    output = writeEscapedByte(output, load<u8>(pointer++));
  }
  store<u8>(output, 0x22);
}

/**
 * Serialize one well-formed host UTF-8 string.
 *
 * Exact measurement precedes the claim, so capacity failure writes no bytes.
 */
export function serializeString_SWAR(source: usize, length: u32): bool {
  const required = measureUtf8(source, length);
  if (required == 0) return false;
  const destination = claimWriter(required);
  if (destination == 0) return false;
  writeUtf8(source, length, destination);
  return true;
}

/**
 * Fast path for a parsed source span known to contain no JSON escapes.
 * Parser validation guarantees quotes and raw controls cannot occur in it.
 */
export function serializeRetainedCleanString_SWAR(
  source: usize,
  length: u32,
): bool {
  if (length > U32.MAX_VALUE - 2) return false;
  const destination = claimWriter(length + 2);
  if (destination == 0) return false;
  store<u8>(destination, 0x22);
  memory.copy(destination + 1, source, length);
  store<u8>(destination + 1 + <usize>length, 0x22);
  return true;
}

/**
 * Copy host-produced canonical JSON string bytes, including quotes.
 *
 * This is the overlay seam: the host retains UTF-16 information long enough
 * for native JSON.stringify to encode unpaired surrogates as `\\udxxx`.
 */
export function serializeCanonicalString_SWAR(
  source: usize,
  length: u32,
): bool {
  const destination = claimWriter(length);
  if (destination == 0) return false;
  memory.copy(destination, source, length);
  return true;
}

@inline
function hexNibble(value: u8): u32 {
  if (value >= 0x30 && value <= 0x39) return value - 0x30;
  return (value | 0x20) - 0x61 + 10;
}

@inline
function decodeHex4(pointer: usize): u32 {
  return (hexNibble(load<u8>(pointer)) << 12) |
    (hexNibble(load<u8>(pointer + 1)) << 8) |
    (hexNibble(load<u8>(pointer + 2)) << 4) |
    hexNibble(load<u8>(pointer + 3));
}

@inline
function utf8Length(code: u32): u32 {
  return code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
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

/**
 * Canonicalize a validated retained JSON-string payload containing escapes.
 * Clean source runs are copied; escape sequences are decoded and emitted using
 * JSON.stringify-compatible spelling.
 */
export function serializeRetainedEscapedString_SWAR(
  source: usize,
  length: u32,
): bool {
  const end = source + <usize>length;
  let pointer = source;
  let required: u64 = 2;

  while (pointer < end) {
    if (load<u8>(pointer) != 0x5c) {
      required++;
      pointer++;
      continue;
    }
    pointer++;
    const escape = load<u8>(pointer++);
    let code: u32;
    if (escape == 0x75) {
      code = decodeHex4(pointer);
      pointer += 4;
      if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        end - pointer >= 6 &&
        load<u8>(pointer) == 0x5c &&
        load<u8>(pointer + 1) == 0x75
      ) {
        const low = decodeHex4(pointer + 2);
        if (low >= 0xdc00 && low <= 0xdfff) {
          pointer += 6;
          code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
        }
      }
    } else if (escape == 0x22 || escape == 0x5c || escape == 0x2f) {
      code = escape;
    } else if (escape == 0x62) code = 0x08;
    else if (escape == 0x66) code = 0x0c;
    else if (escape == 0x6e) code = 0x0a;
    else if (escape == 0x72) code = 0x0d;
    else code = 0x09;

    required += code >= 0xd800 && code <= 0xdfff
      ? 6
      : code < 0x20 || code == 0x22 || code == 0x5c
        ? escapedLength(<u8>code)
        : utf8Length(code);
  }
  if (required > U32.MAX_VALUE) return false;
  const destination = claimWriter(<u32>required);
  if (destination == 0) return false;

  pointer = source;
  let output = destination;
  store<u8>(output++, 0x22);
  let run = pointer;
  while (pointer < end) {
    if (load<u8>(pointer) != 0x5c) {
      pointer++;
      continue;
    }
    if (pointer > run) {
      const runLength = pointer - run;
      memory.copy(output, run, runLength);
      output += runLength;
    }
    pointer++;
    const escape = load<u8>(pointer++);
    let code: u32;
    if (escape == 0x75) {
      code = decodeHex4(pointer);
      pointer += 4;
      if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        end - pointer >= 6 &&
        load<u8>(pointer) == 0x5c &&
        load<u8>(pointer + 1) == 0x75
      ) {
        const low = decodeHex4(pointer + 2);
        if (low >= 0xdc00 && low <= 0xdfff) {
          pointer += 6;
          code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
        }
      }
    } else if (escape == 0x22 || escape == 0x5c || escape == 0x2f) {
      code = escape;
    } else if (escape == 0x62) code = 0x08;
    else if (escape == 0x66) code = 0x0c;
    else if (escape == 0x6e) code = 0x0a;
    else if (escape == 0x72) code = 0x0d;
    else code = 0x09;

    output = code >= 0xd800 && code <= 0xdfff
      ? writeSurrogateEscape(output, code)
      : writeScalar(output, code);
    run = pointer;
  }
  if (pointer > run) {
    memory.copy(output, run, pointer - run);
    output += pointer - run;
  }
  store<u8>(output, 0x22);
  return true;
}

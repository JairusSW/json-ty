import { writeByte, writeRaw } from "./writer";
import {
  serializeRetainedCleanString_SWAR,
  serializeRetainedEscapedString_SWAR,
} from "./swar/string";

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
function lowerHex(value: u32): u32 {
  return value < 10 ? 0x30 + value : 0x61 + value - 10;
}

function writeUnicodeEscape(code: u32): bool {
  return writeByte(0x5c) &&
    writeByte(0x75) &&
    writeByte(lowerHex((code >> 12) & 15)) &&
    writeByte(lowerHex((code >> 8) & 15)) &&
    writeByte(lowerHex((code >> 4) & 15)) &&
    writeByte(lowerHex(code & 15));
}

function writeUtf8Scalar(code: u32): bool {
  if (code <= 0x7f) return writeByte(code);
  if (code <= 0x7ff) {
    return writeByte(0xc0 | (code >> 6)) &&
      writeByte(0x80 | (code & 0x3f));
  }
  if (code <= 0xffff) {
    return writeByte(0xe0 | (code >> 12)) &&
      writeByte(0x80 | ((code >> 6) & 0x3f)) &&
      writeByte(0x80 | (code & 0x3f));
  }
  return writeByte(0xf0 | (code >> 18)) &&
    writeByte(0x80 | ((code >> 12) & 0x3f)) &&
    writeByte(0x80 | ((code >> 6) & 0x3f)) &&
    writeByte(0x80 | (code & 0x3f));
}

function writeCanonicalCodeUnit(code: u32): bool {
  if (code == 0x22) return writeByte(0x5c) && writeByte(0x22);
  if (code == 0x5c) return writeByte(0x5c) && writeByte(0x5c);
  if (code == 0x08) return writeByte(0x5c) && writeByte(0x62);
  if (code == 0x09) return writeByte(0x5c) && writeByte(0x74);
  if (code == 0x0a) return writeByte(0x5c) && writeByte(0x6e);
  if (code == 0x0c) return writeByte(0x5c) && writeByte(0x66);
  if (code == 0x0d) return writeByte(0x5c) && writeByte(0x72);
  if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) return writeUnicodeEscape(code);
  return writeUtf8Scalar(code);
}

// Parsed string slots retain their escaped UTF-8 source. Decode only the cold
// escaped spans and emit the exact lexical form used by JSON.stringify.
function serializeEscapedSpan(source: usize, length: u32): bool {
  const end = source + <usize>length;
  let cursor = source;
  let run = source;
  while (cursor < end) {
    if (load<u8>(cursor) != 0x5c) {
      cursor++;
      continue;
    }
    if (cursor > run && !writeRaw(<u32>run, <u32>(cursor - run))) return false;
    cursor++;
    if (cursor >= end) return false;
    const escape = load<u8>(cursor++);
    let code: u32;
    if (escape == 0x75) {
      if (cursor + 4 > end) return false;
      code = decodeHex4(cursor);
      cursor += 4;
      if (
        code >= 0xd800 && code <= 0xdbff &&
        cursor + 6 <= end &&
        load<u8>(cursor) == 0x5c &&
        load<u8>(cursor + 1) == 0x75
      ) {
        const low = decodeHex4(cursor + 2);
        if (low >= 0xdc00 && low <= 0xdfff) {
          cursor += 6;
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        }
      }
    } else if (escape == 0x22 || escape == 0x5c || escape == 0x2f) {
      code = escape;
    } else if (escape == 0x62) {
      code = 0x08;
    } else if (escape == 0x66) {
      code = 0x0c;
    } else if (escape == 0x6e) {
      code = 0x0a;
    } else if (escape == 0x72) {
      code = 0x0d;
    } else if (escape == 0x74) {
      code = 0x09;
    } else {
      return false;
    }
    if (!writeCanonicalCodeUnit(code)) return false;
    run = cursor;
  }
  return cursor == run || writeRaw(<u32>run, <u32>(cursor - run));
}

@inline
export function serializeString(document: usize, source: usize): bool {
  const offset = load<u32>(source);
  const taggedLength = load<u32>(source + 4);
  const length = taggedLength & 0x3fffffff;
  if (JSON_TY_KERNEL_TIER == 0) {
    return writeByte(0x22) &&
      (((taggedLength & 0x80000000) == 0)
        ? writeRaw(<u32>(document + offset), length)
        : serializeEscapedSpan(document + offset, length)) &&
      writeByte(0x22);
  }
  return (taggedLength & 0x80000000) == 0
    ? serializeRetainedCleanString_SWAR(document + offset, length)
    : serializeRetainedEscapedString_SWAR(document + offset, length);
}

@inline
export function serializeStringSpan(document: usize, offset: u32, taggedLength: u32): bool {
  const length = taggedLength & 0x3fffffff;
  if (JSON_TY_KERNEL_TIER == 0) {
    return writeByte(0x22) &&
      (((taggedLength & 0x80000000) == 0)
        ? writeRaw(<u32>(document + offset), length)
        : serializeEscapedSpan(document + offset, length)) &&
      writeByte(0x22);
  }
  return (taggedLength & 0x80000000) == 0
    ? serializeRetainedCleanString_SWAR(document + offset, length)
    : serializeRetainedEscapedString_SWAR(document + offset, length);
}

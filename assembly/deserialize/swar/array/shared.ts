import { scanValueEnd_SWAR } from "../../../util/scanValueEndSwar";

@inline
export function isWhitespace(value: u8): bool {
  return value == 0x20 ||
    value == 0x09 ||
    value == 0x0a ||
    value == 0x0d;
}

@inline
export function skipWhitespace(start: usize, end: usize): usize {
  while (start < end && isWhitespace(load<u8>(start))) start++;
  return start;
}

export function scanValueEnd(start: usize, end: usize): usize {
  return scanValueEnd_SWAR(start, end);
}

/**
 * Count an array and return `(closingPointer + 1) << 32 | count`.
 * Zero is malformed input. Values are boundary-scanned here and fully
 * validated by the materializing pass.
 */
export function countArrayElements_SWAR(start: usize, end: usize): u64 {
  if (start >= end || load<u8>(start) != 0x5b) return 0;
  let pointer = skipWhitespace(start + 1, end);
  let count: u32 = 0;
  if (pointer < end && load<u8>(pointer) == 0x5d) {
    return <u64>(pointer + 1) << 32;
  }
  while (pointer < end) {
    const next = scanValueEnd_SWAR(pointer, end);
    if (next == 0 || next == pointer) return 0;
    count++;
    pointer = skipWhitespace(next, end);
    if (pointer >= end) return 0;
    const separator = load<u8>(pointer);
    if (separator == 0x5d) return (<u64>(pointer + 1) << 32) | count;
    if (separator != 0x2c) return 0;
    pointer = skipWhitespace(pointer + 1, end);
    if (pointer >= end || load<u8>(pointer) == 0x5d) return 0;
  }
  return 0;
}


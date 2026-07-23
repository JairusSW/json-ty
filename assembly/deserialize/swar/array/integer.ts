import { initializeArray, ARRAY_NUMBER } from "../../../layout/array";
import { parse4Digits_SWAR } from "../../../util/swar-int";
import { countArrayElements_SWAR, skipWhitespace } from "./shared";

@inline
function append4Overflow(value: u64, chunk: u64): bool {
  return value > (U64.MAX_VALUE - chunk) / 10_000;
}

// Preserve json-as's array tuning: parse4 + scalar. Mixed-width array elements
// make an 8-byte probe hit a comma too often to amortize validation.
@inline
function parseU64Element(start: usize, end: usize, destination: usize): usize {
  if (start >= end) return 0;
  let digit = <u64>(load<u8>(start) - 0x30);
  if (digit > 9) return 0;
  if (digit == 0 && start + 1 < end && <u32>(load<u8>(start + 1) - 0x30) <= 9) {
    return 0;
  }

  let pointer = start;
  let value: u64 = 0;
  let digits: u32 = 0;
  while (end - pointer >= 4) {
    const chunk = parse4Digits_SWAR(load<u32>(pointer));
    if (chunk == U32.MAX_VALUE) break;
    if (digits + 4 >= 20 && append4Overflow(value, chunk)) return 0;
    value = value * 10_000 + chunk;
    pointer += 4;
    digits += 4;
  }
  while (pointer < end) {
    digit = <u64>(load<u8>(pointer) - 0x30);
    if (digit > 9) break;
    if (digits >= 19 && value > (U64.MAX_VALUE - digit) / 10) return 0;
    value = value * 10 + digit;
    pointer++;
    digits++;
  }
  store<u64>(destination, value);
  return pointer;
}

export function countU64ArrayElements_SWAR(start: usize, end: usize): u64 {
  return countArrayElements_SWAR(start, end);
}

/**
 * Materialize a pre-counted u64 array into caller-owned document storage.
 * `header` and `data` may belong to one contiguous allocation.
 */
export function deserializeU64Array_SWAR(
  start: usize,
  end: usize,
  document: usize,
  header: usize,
  data: usize,
  capacity: u32,
): usize {
  if (start >= end || load<u8>(start) != 0x5b) return 0;
  let pointer = skipWhitespace(start + 1, end);
  let count: u32 = 0;
  if (pointer < end && load<u8>(pointer) == 0x5d) {
    initializeArray(header, document, ARRAY_NUMBER, 0, data, 8);
    return pointer + 1;
  }

  while (pointer < end) {
    if (count >= capacity) return 0;
    pointer = parseU64Element(pointer, end, data + <usize>count * 8);
    if (pointer == 0) return 0;
    count++;
    pointer = skipWhitespace(pointer, end);
    if (pointer >= end) return 0;
    const separator = load<u8>(pointer);
    if (separator == 0x5d) {
      initializeArray(header, document, ARRAY_NUMBER, count, data, 8);
      return pointer + 1;
    }
    if (separator != 0x2c) return 0;
    pointer = skipWhitespace(pointer + 1, end);
    if (pointer >= end || load<u8>(pointer) == 0x5d) return 0;
  }
  return 0;
}


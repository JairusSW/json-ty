import { initializeArray, ARRAY_BOOLEAN } from "../../../layout/array";
import { countArrayElements_SWAR, skipWhitespace } from "./shared";

export function countBooleanArrayElements_SWAR(start: usize, end: usize): u64 {
  return countArrayElements_SWAR(start, end);
}

/**
 * Direct-write boolean array parser. Packed `true`/`fals` comparisons retain
 * json-as's literal path while byte addressing halves the source stride.
 */
export function deserializeBooleanArray_SWAR(
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
    initializeArray(header, document, ARRAY_BOOLEAN, 0, data, 4);
    return pointer + 1;
  }

  while (pointer < end) {
    if (count >= capacity) return 0;
    if (end - pointer >= 4 && load<u32>(pointer) == 0x6575_7274) {
      store<u32>(data + <usize>count * 4, 1);
      pointer += 4;
    } else if (
      end - pointer >= 5 &&
      load<u32>(pointer) == 0x736c_6166 &&
      load<u8>(pointer + 4) == 0x65
    ) {
      store<u32>(data + <usize>count * 4, 0);
      pointer += 5;
    } else {
      return 0;
    }
    count++;
    pointer = skipWhitespace(pointer, end);
    if (pointer >= end) return 0;
    const separator = load<u8>(pointer);
    if (separator == 0x5d) {
      initializeArray(header, document, ARRAY_BOOLEAN, count, data, 4);
      return pointer + 1;
    }
    if (separator != 0x2c) return 0;
    pointer = skipWhitespace(pointer + 1, end);
    if (pointer >= end || load<u8>(pointer) == 0x5d) return 0;
  }
  return 0;
}


import {
  countU64ArrayElements_SWAR,
  deserializeU64Array_SWAR,
} from "../deserialize/swar/array/integer";
import {
  countBooleanArrayElements_SWAR,
  deserializeBooleanArray_SWAR,
} from "../deserialize/swar/array/bool";
import { initializeArray, ARRAY_NUMBER } from "../../assembly/layout/array";

export function countU64(start: usize, end: usize): u64 {
  return countU64ArrayElements_SWAR(start, end);
}

export function countBool(start: usize, end: usize): u64 {
  return countBooleanArrayElements_SWAR(start, end);
}

export function parseU64(
  start: usize,
  end: usize,
  document: usize,
  header: usize,
  data: usize,
  capacity: u32,
): usize {
  return deserializeU64Array_SWAR(
    start,
    end,
    document,
    header,
    data,
    capacity,
  );
}

export function parseBool(
  start: usize,
  end: usize,
  document: usize,
  header: usize,
  data: usize,
  capacity: u32,
): usize {
  return deserializeBooleanArray_SWAR(
    start,
    end,
    document,
    header,
    data,
    capacity,
  );
}

function parseU64ArrayScalar(
  start: usize,
  end: usize,
  document: usize,
  header: usize,
  data: usize,
  capacity: u32,
): usize {
  if (start >= end || load<u8>(start) != 0x5b) return 0;
  let pointer = start + 1;
  let count: u32 = 0;
  while (pointer < end) {
    while (
      pointer < end &&
      (load<u8>(pointer) == 0x20 ||
        load<u8>(pointer) == 0x09 ||
        load<u8>(pointer) == 0x0a ||
        load<u8>(pointer) == 0x0d)
    ) pointer++;
    if (pointer < end && load<u8>(pointer) == 0x5d) {
      initializeArray(header, document, ARRAY_NUMBER, count, data, 8);
      return pointer + 1;
    }
    if (count >= capacity) return 0;
    let digit = <u64>(load<u8>(pointer) - 0x30);
    if (digit > 9) return 0;
    if (
      digit == 0 &&
      pointer + 1 < end &&
      <u32>(load<u8>(pointer + 1) - 0x30) <= 9
    ) return 0;
    let value: u64 = 0;
    let digits: u32 = 0;
    while (pointer < end) {
      digit = <u64>(load<u8>(pointer) - 0x30);
      if (digit > 9) break;
      if (digits >= 19 && value > (U64.MAX_VALUE - digit) / 10) return 0;
      value = value * 10 + digit;
      pointer++;
      digits++;
    }
    store<u64>(data + <usize>count * 8, value);
    count++;
    while (
      pointer < end &&
      (load<u8>(pointer) == 0x20 ||
        load<u8>(pointer) == 0x09 ||
        load<u8>(pointer) == 0x0a ||
        load<u8>(pointer) == 0x0d)
    ) pointer++;
    if (pointer >= end) return 0;
    const separator = load<u8>(pointer);
    if (separator == 0x5d) {
      initializeArray(header, document, ARRAY_NUMBER, count, data, 8);
      return pointer + 1;
    }
    if (separator != 0x2c) return 0;
    pointer++;
  }
  return 0;
}

export function benchU64Swar(
  start: usize,
  end: usize,
  document: usize,
  header: usize,
  data: usize,
  capacity: u32,
  iterations: u32,
): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    deserializeU64Array_SWAR(
      start,
      end,
      document,
      header,
      data,
      capacity,
    );
    checksum += load<u64>(data + <usize>(index % capacity) * 8);
  }
  return checksum;
}

export function benchU64Scalar(
  start: usize,
  end: usize,
  document: usize,
  header: usize,
  data: usize,
  capacity: u32,
  iterations: u32,
): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    parseU64ArrayScalar(start, end, document, header, data, capacity);
    checksum += load<u64>(data + <usize>(index % capacity) * 8);
  }
  return checksum;
}


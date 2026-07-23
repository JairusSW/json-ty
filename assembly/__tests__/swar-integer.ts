import {
  deserializeInteger_SWAR,
  deserializeUnsigned_SWAR,
  parseUnsignedExact_SWAR,
} from "../deserialize/swar/integer";

const RESULT: usize = memory.data<u64>([0]);

export function scanUnsigned(
  start: usize,
  end: usize,
  maximum: u64,
): usize {
  return deserializeUnsigned_SWAR(start, end, RESULT, maximum);
}

export function scanSigned(start: usize, end: usize): usize {
  return deserializeInteger_SWAR(start, end, RESULT);
}

export function parseExact(start: usize, end: usize, maximum: u64): bool {
  return parseUnsignedExact_SWAR(start, end, RESULT, maximum);
}

export function unsignedResult(): u64 {
  return load<u64>(RESULT);
}

export function signedResult(): i64 {
  return load<i64>(RESULT);
}

function scalarUnsigned(
  start: usize,
  end: usize,
  destination: usize,
): usize {
  if (start >= end) return 0;
  let first = <u64>(load<u8>(start) - 0x30);
  if (first > 9) return 0;
  if (first == 0) {
    if (start + 1 < end && <u32>(load<u8>(start + 1) - 0x30) <= 9) return 0;
    store<u64>(destination, 0);
    return start + 1;
  }
  let value: u64 = 0;
  while (start < end) {
    const digit = <u64>(load<u8>(start) - 0x30);
    if (digit > 9) break;
    if (value > (U64.MAX_VALUE - digit) / 10) return 0;
    value = value * 10 + digit;
    start++;
  }
  store<u64>(destination, value);
  return start;
}

export function benchUnsignedSwar(
  start: usize,
  width: u32,
  count: u32,
  rounds: u32,
): u64 {
  let checksum: u64 = 0;
  for (let round: u32 = 0; round < rounds; round++) {
    let pointer = start;
    for (let index: u32 = 0; index < count; index++) {
      deserializeUnsigned_SWAR(pointer, pointer + width, RESULT);
      checksum += load<u64>(RESULT);
      pointer += width;
    }
  }
  return checksum;
}

export function benchUnsignedScalar(
  start: usize,
  width: u32,
  count: u32,
  rounds: u32,
): u64 {
  let checksum: u64 = 0;
  for (let round: u32 = 0; round < rounds; round++) {
    let pointer = start;
    for (let index: u32 = 0; index < count; index++) {
      scalarUnsigned(pointer, pointer + width, RESULT);
      checksum += load<u64>(RESULT);
      pointer += width;
    }
  }
  return checksum;
}


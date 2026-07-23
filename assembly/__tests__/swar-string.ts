import { scanString_SWAR } from "../deserialize/swar/string";

@inline
function continuation(value: u8): bool {
  return (value & 0xc0) == 0x80;
}

function scalarUtf8(pointer: usize, end: usize): usize {
  const first = load<u8>(pointer);
  if (first < 0x80) return pointer + 1;
  if (first >= 0xc2 && first <= 0xdf) {
    return pointer + 2 <= end && continuation(load<u8>(pointer + 1))
      ? pointer + 2
      : 0;
  }
  if (first >= 0xe0 && first <= 0xef) {
    if (pointer + 3 > end) return 0;
    const second = load<u8>(pointer + 1);
    if (
      !continuation(load<u8>(pointer + 2)) ||
      (first == 0xe0
        ? second < 0xa0 || second > 0xbf
        : first == 0xed
          ? second < 0x80 || second > 0x9f
          : !continuation(second))
    ) return 0;
    return pointer + 3;
  }
  if (first >= 0xf0 && first <= 0xf4) {
    if (pointer + 4 > end) return 0;
    const second = load<u8>(pointer + 1);
    if (
      (first == 0xf0
        ? second < 0x90 || second > 0xbf
        : first == 0xf4
          ? second < 0x80 || second > 0x8f
          : !continuation(second)) ||
      !continuation(load<u8>(pointer + 2)) ||
      !continuation(load<u8>(pointer + 3))
    ) return 0;
    return pointer + 4;
  }
  return 0;
}

@inline
function hex(value: u8): bool {
  return (value >= 0x30 && value <= 0x39) ||
    (value >= 0x41 && value <= 0x46) ||
    (value >= 0x61 && value <= 0x66);
}

function scanScalar(start: usize, end: usize, trusted: bool): u64 {
  if (start >= end || load<u8>(start) != 0x22) return 0;
  let pointer = start + 1;
  let escaped = false;
  while (pointer < end) {
    const value = load<u8>(pointer);
    if (value == 0x22) {
      return (<u64>(pointer + 1) << 32) | <u64>(escaped ? 1 : 0);
    }
    if (value < 0x20) return 0;
    if (value == 0x5c) {
      escaped = true;
      pointer++;
      if (pointer >= end) return 0;
      const escape = load<u8>(pointer);
      if (escape == 0x75) {
        if (
          pointer + 5 > end ||
          !hex(load<u8>(pointer + 1)) ||
          !hex(load<u8>(pointer + 2)) ||
          !hex(load<u8>(pointer + 3)) ||
          !hex(load<u8>(pointer + 4))
        ) return 0;
        pointer += 5;
      } else {
        if (
          escape != 0x22 &&
          escape != 0x5c &&
          escape != 0x2f &&
          escape != 0x62 &&
          escape != 0x66 &&
          escape != 0x6e &&
          escape != 0x72 &&
          escape != 0x74
        ) return 0;
        pointer++;
      }
    } else if (!trusted && value >= 0x80) {
      pointer = scalarUtf8(pointer, end);
      if (pointer == 0) return 0;
    } else {
      pointer++;
    }
  }
  return 0;
}

export function scan(start: usize, end: usize, trusted: bool): u64 {
  return scanString_SWAR(start, end, trusted);
}

export function scanReference(start: usize, end: usize, trusted: bool): u64 {
  return scanScalar(start, end, trusted);
}

export function benchSwar(
  start: usize,
  end: usize,
  iterations: u32,
  trusted: bool,
): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    checksum += scanString_SWAR(start, end, trusted);
  }
  return checksum;
}

export function benchScalar(
  start: usize,
  end: usize,
  iterations: u32,
  trusted: bool,
): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    checksum += scanScalar(start, end, trusted);
  }
  return checksum;
}


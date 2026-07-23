import { scanValueEnd_SWAR } from "../util/scanValueEndSwar";

function scanQuotedScalar(start: usize, end: usize): usize {
  let pointer = start + 1;
  while (pointer < end) {
    const code = load<u8>(pointer);
    if (code == 0x5c) {
      pointer += 2;
      continue;
    }
    if (code == 0x22) return pointer + 1;
    pointer++;
  }
  return 0;
}

function scanValueEndScalar(start: usize, end: usize): usize {
  if (start >= end) return 0;
  const first = load<u8>(start);
  if (first == 0x22) return scanQuotedScalar(start, end);
  if (first != 0x7b && first != 0x5b) {
    while (start < end) {
      const code = load<u8>(start);
      if (
        code == 0x2c ||
        code == 0x5d ||
        code == 0x7d ||
        code == 0x20 ||
        (code >= 0x09 && code <= 0x0d)
      ) return start;
      start++;
    }
    return start;
  }

  let depth: i32 = 1;
  let pointer = start + 1;
  while (pointer < end) {
    const code = load<u8>(pointer);
    if (code == 0x22) {
      pointer = scanQuotedScalar(pointer, end);
      if (pointer == 0) return 0;
      continue;
    }
    const folded = code & 0xdf;
    if (folded == 0x5b) depth++;
    else if (folded == 0x5d && --depth == 0) return pointer + 1;
    pointer++;
  }
  return 0;
}

export function scan(start: usize, end: usize): usize {
  return scanValueEnd_SWAR(start, end);
}

export function scanScalar(start: usize, end: usize): usize {
  return scanValueEndScalar(start, end);
}

export function benchScan(start: usize, end: usize, iterations: u32): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    checksum += scanValueEnd_SWAR(start, end);
  }
  return checksum;
}

export function benchScalar(start: usize, end: usize, iterations: u32): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    checksum += scanValueEndScalar(start, end);
  }
  return checksum;
}


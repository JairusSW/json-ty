import { scanString_SIMD, scanString_SIMD_LOOKUP4 } from "../deserialize/simd/string";
import { scanString_SWAR } from "../deserialize/swar/string";

export function scan(start: usize, end: usize, trusted: bool): u64 {
  return scanString_SIMD(start, end, trusted);
}

export function scanReference(start: usize, end: usize, trusted: bool): u64 {
  return scanString_SWAR(start, end, trusted);
}

export function benchSimd(start: usize, end: usize, iterations: u32, trusted: bool): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    checksum += scanString_SIMD(start, end, trusted);
  }
  return checksum;
}

export function benchSwar(start: usize, end: usize, iterations: u32, trusted: bool): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    checksum += scanString_SWAR(start, end, trusted);
  }
  return checksum;
}

export function scanLookup4(start: usize, end: usize, trusted: bool): u64 {
  return scanString_SIMD_LOOKUP4(start, end, trusted);
}

export function benchLookup4(start: usize, end: usize, iterations: u32, trusted: bool): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) checksum += scanString_SIMD_LOOKUP4(start, end, trusted);
  return checksum;
}

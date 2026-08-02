import { scanValueEnd_SIMD, scanValueEnd_SIMD_PARITY } from "../deserialize/simd/document";
import { scanValueEnd_SWAR } from "../util/scanValueEndSwar";

export function scan(start: usize, end: usize): usize {
  return scanValueEnd_SIMD(start, end);
}

export function oracle(start: usize, end: usize): usize {
  return scanValueEnd_SWAR(start, end);
}

export function benchSimd(start: usize, end: usize, iterations: u32): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    checksum += scanValueEnd_SIMD(start, end);
  }
  return checksum;
}

export function benchSwar(start: usize, end: usize, iterations: u32): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    checksum += scanValueEnd_SWAR(start, end);
  }
  return checksum;
}

export function scanParity(start: usize, end: usize): usize {
  return scanValueEnd_SIMD_PARITY(start, end);
}

export function benchParity(start: usize, end: usize, iterations: u32): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) checksum += scanValueEnd_SIMD_PARITY(start, end);
  return checksum;
}

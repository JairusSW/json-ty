import { scanValueEnd_SIMD } from "../deserialize/simd/document";
import { scanValueEnd_SWAR } from "../util/scanValueEndSwar";

export function scan(start: usize, end: usize): usize {
  return scanValueEnd_SIMD(start, end);
}

export function oracle(start: usize, end: usize): usize {
  return scanValueEnd_SWAR(start, end);
}

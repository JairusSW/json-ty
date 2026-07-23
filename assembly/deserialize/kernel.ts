import { deserializeFloat_NAIVE } from "./naive/float";
import { scanString_NAIVE } from "./naive/string";
import { scanValueEnd_SIMD } from "./simd/document";
import { scanString_SIMD } from "./simd/string";
import { deserializeFloat_SWAR } from "./swar/float";
import { scanString_SWAR } from "./swar/string";
import { scanValueEnd_SWAR } from "../util/scanValueEndSwar";

const USE_NAIVE_KERNEL: bool = JSON_TY_KERNEL_TIER == 0;
const USE_SIMD_KERNEL: bool = JSON_TY_KERNEL_TIER == 2 && ASC_FEATURE_SIMD;

/** Complete compile-time selection policy for deserialization kernels. */
@inline
export function scanStringKernel(start: usize, end: usize, trusted: bool): u64 {
  if (USE_NAIVE_KERNEL) return scanString_NAIVE(start, end, trusted);
  if (USE_SIMD_KERNEL) {
    return end - start < 48
      ? scanString_SWAR(start, end, trusted)
      : scanString_SIMD(start, end, trusted);
  }
  return scanString_SWAR(start, end, trusted);
}

@inline
export function deserializeF64Kernel(
  start: usize,
  end: usize,
  destination: usize,
): usize {
  return USE_NAIVE_KERNEL
    ? deserializeFloat_NAIVE(start, end, destination)
    : deserializeFloat_SWAR(start, end, destination);
}

/** Boundary scan for caller-validated canonical UTF-8 JSON. */
@inline
export function scanValueEndTrustedKernel(start: usize, end: usize): usize {
  return USE_SIMD_KERNEL
    ? scanValueEnd_SIMD(start, end)
    : scanValueEnd_SWAR(start, end);
}

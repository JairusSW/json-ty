import { scanValueEnd_SWAR } from "./scanValueEndSwar";
import { scanValueEnd_SIMD } from "./scanValueEndSimd";

/** Boundary scan for caller-validated canonical UTF-8 JSON. */
@inline
export function scanValueEndTrusted(start: usize, end: usize): usize {
  return ASC_FEATURE_SIMD
    ? scanValueEnd_SIMD(start, end)
    : scanValueEnd_SWAR(start, end);
}

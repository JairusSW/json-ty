import { scanValueEndTrustedKernel } from "../deserialize/kernel";

/** Boundary scan for caller-validated canonical UTF-8 JSON. */
@inline
export function scanValueEndTrusted(start: usize, end: usize): usize {
  return scanValueEndTrustedKernel(start, end);
}

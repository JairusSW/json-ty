import { deserializeFloat_SWAR } from "./swar/float";
import { deserializeFloat_NAIVE } from "./naive/float";

@inline
export function deserializeF64(cursor: usize, end: usize, destination: usize): usize {
  return JSON_TY_KERNEL_TIER == 0
    ? deserializeFloat_NAIVE(cursor, end, destination)
    : deserializeFloat_SWAR(cursor, end, destination);
}

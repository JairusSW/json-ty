import { deserializeFloatScalar } from "../swar/float";

// Same RFC grammar and conversion as the optimized parser, with the packed
// fractional digit fold disabled. Kept behind a distinct canonical tier path
// so optimized number changes always have a scalar differential oracle.
@inline
export function deserializeFloat_NAIVE(
  start: usize,
  end: usize,
  destination: usize,
): usize {
  return deserializeFloatScalar(start, end, destination);
}

import { parseNumber } from "./scanner";

@inline
export function deserializeF64(cursor: usize, end: usize, destination: usize): usize {
  return parseNumber(cursor, end, destination);
}

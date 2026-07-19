import { countArrayElements } from "./scanner";
export { initializeArray } from "../layout/array";

@inline
export function inspectArray(cursor: usize, end: usize): u64 {
  return countArrayElements(cursor, end);
}

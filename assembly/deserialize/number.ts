import { deserializeF64Kernel } from "./kernel";

@inline
export function deserializeF64(cursor: usize, end: usize, destination: usize): usize {
  return deserializeF64Kernel(cursor, end, destination);
}

@inline
export function deserializeNull(cursor: usize, end: usize): usize {
  return cursor + 4 <= end && load<u32>(cursor) == 0x6c6c756e ? cursor + 4 : 0;
}

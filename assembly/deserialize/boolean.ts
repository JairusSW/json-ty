@inline
export function deserializeBoolean(cursor: usize, end: usize, destination: usize): usize {
  if (cursor + 4 <= end && load<u32>(cursor) == 0x65757274) {
    store<u32>(destination, 1);
    return cursor + 4;
  }
  if (cursor + 5 <= end && load<u32>(cursor) == 0x736c6166 && load<u8>(cursor + 4) == 0x65) {
    store<u32>(destination, 0);
    return cursor + 5;
  }
  return 0;
}

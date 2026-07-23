// Flat record layout: presence/null bitmaps followed by aligned 8-byte slots.

export const RECORD_HEADER_SIZE: usize = 8;
export const RECORD_SLOT_SIZE: usize = 8;
export const RECORD_PRESENCE_OFFSET: usize = 0;
export const RECORD_NULLS_OFFSET: usize = 4;

@inline
export function recordSlot(record: usize, index: u32): usize {
  return record + RECORD_HEADER_SIZE + <usize>index * RECORD_SLOT_SIZE;
}

@inline
export function fieldMask(index: u32): u32 {
  return 1 << index;
}

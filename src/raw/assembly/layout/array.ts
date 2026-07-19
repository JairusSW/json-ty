// Flat array descriptor. Elements live in a separate contiguous graph region.

export const ARRAY_HEADER_SIZE: usize = 16;
export const ARRAY_KIND_OFFSET: usize = 0;
export const ARRAY_LENGTH_OFFSET: usize = 4;
export const ARRAY_DATA_OFFSET: usize = 8;
export const ARRAY_STRIDE_OFFSET: usize = 12;

export const ARRAY_NUMBER: u32 = 1;
export const ARRAY_BOOLEAN: u32 = 2;
export const ARRAY_STRING: u32 = 3;
export const ARRAY_OBJECT: u32 = 4;
export const ARRAY_ARRAY: u32 = 5;
export const ARRAY_TUPLE: u32 = 6;
export const ARRAY_UNION: u32 = 7;

@inline
export function initializeArray(header: usize, document: usize, kind: u32, length: u32, data: usize, stride: u32): void {
  store<u32>(header + ARRAY_KIND_OFFSET, kind);
  store<u32>(header + ARRAY_LENGTH_OFFSET, length);
  store<u32>(header + ARRAY_DATA_OFFSET, <u32>(data - document));
  store<u32>(header + ARRAY_STRIDE_OFFSET, stride);
}

import { skipWhitespace } from "./scanner";

@inline
export function beginStruct(cursor: usize, end: usize): usize {
  cursor = skipWhitespace(cursor, end);
  return cursor < end && load<u8>(cursor) == 0x7b ? cursor + 1 : 0;
}

@inline
export function finishDocument(cursor: usize, end: usize): usize {
  cursor = skipWhitespace(cursor, end);
  return cursor == end ? cursor : 0;
}

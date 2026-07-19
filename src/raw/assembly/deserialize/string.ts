import { lastStringHadEscape, scanStringContent } from "./scanner";

// Parses a JSON string into the flat {relativeOffset, taggedLength} reference.
// Source bytes remain escaped and are decoded only when the host reads them.
@inline
export function deserializeString(cursor: usize, end: usize, destination: usize, document: usize): usize {
  if (cursor >= end || load<u8>(cursor) != 0x22) return 0;
  const content = cursor + 1;
  const quote = scanStringContent(content, end);
  if (quote == 0) return 0;
  store<u32>(destination, <u32>(content - document));
  let length = <u32>(quote - content);
  if (lastStringHadEscape()) length |= 0x80000000;
  store<u32>(destination + 4, length);
  return quote + 1;
}

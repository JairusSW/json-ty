import { scanStringContentResult } from "./scanner";

// Parses a JSON string into the flat {relativeOffset, taggedLength} reference.
// Source bytes remain escaped and are decoded only when the host reads them.
@inline
export function deserializeString(cursor: usize, end: usize, destination: usize, document: usize): usize {
  const content = cursor + 1;
  const result = scanStringContentResult(content, end);
  if (result == 0) return 0;
  const quote = <usize>(result >> 32) - 1;
  let length = <u32>(quote - content);
  if ((result & 1) != 0) length |= 0x80000000;
  store<u64>(
    destination,
    <u64><u32>(content - document) | (<u64>length << 32),
  );
  return quote + 1;
}

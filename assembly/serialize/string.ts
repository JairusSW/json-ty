import { serializeRetainedStringKernel } from "./kernel";


@inline
export function serializeString(document: usize, source: usize): bool {
  const offset = load<u32>(source);
  const taggedLength = load<u32>(source + 4);
  const length = taggedLength & 0x3fffffff;
  return serializeRetainedStringKernel(document + offset, length, (taggedLength & 0x80000000) != 0);
}


@inline
export function serializeStringSpan(document: usize, offset: u32, taggedLength: u32): bool {
  const length = taggedLength & 0x3fffffff;
  return serializeRetainedStringKernel(document + offset, length, (taggedLength & 0x80000000) != 0);
}

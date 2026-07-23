import {
  deserializeDynamicDocument_SWAR,
  lastDocumentFaultOffset,
} from "../deserialize/swar/document";
import { deserializeU64Array_SWAR } from "../deserialize/swar/array/integer";

export function parseDocument(
  sourceStart: usize,
  end: usize,
  document: usize,
  root: usize,
  graphStart: usize,
  graphEnd: usize,
  trusted: bool,
): u64 {
  return deserializeDynamicDocument_SWAR(
    sourceStart,
    end,
    document,
    root,
    graphStart,
    graphEnd,
    trusted,
  );
}

export function faultOffset(): u32 {
  return lastDocumentFaultOffset();
}

export function parseTypedU64Array(
  start: usize,
  end: usize,
  document: usize,
  header: usize,
  data: usize,
  capacity: u32,
): usize {
  return deserializeU64Array_SWAR(
    start,
    end,
    document,
    header,
    data,
    capacity,
  );
}

export function benchDocument(
  sourceStart: usize,
  end: usize,
  document: usize,
  root: usize,
  graphStart: usize,
  graphEnd: usize,
  trusted: bool,
  iterations: u32,
): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    checksum += deserializeDynamicDocument_SWAR(
      sourceStart,
      end,
      document,
      root,
      graphStart,
      graphEnd,
      trusted,
    );
  }
  return checksum;
}


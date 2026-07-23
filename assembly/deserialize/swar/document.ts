import {
  DYNAMIC_ARRAY,
  DYNAMIC_ARRAY_ENTRY_SIZE,
  DYNAMIC_ARRAY_SLOT_OFFSET,
  DYNAMIC_BOOLEAN,
  DYNAMIC_ENTRY_NEXT_OFFSET,
  DYNAMIC_ENTRY_SIZE,
  DYNAMIC_ENTRY_SLOT_OFFSET,
  DYNAMIC_NULL,
  DYNAMIC_NUMBER,
  DYNAMIC_OBJECT,
  DYNAMIC_SLOT_AUX_OFFSET,
  DYNAMIC_SLOT_PAYLOAD_OFFSET,
  DYNAMIC_STRING,
} from "../../layout/dynamic";
import { deserializeFloat_SWAR } from "./float";
import { scanString_SWAR } from "./string";
import { skipWhitespace } from "./array/shared";

let documentBase: usize = 0;
let sourceBase: usize = 0;
let graphCursor: usize = 0;
let graphLimit: usize = 0;
let trustedStrings = false;
let faultOffset: u32 = 0;

@inline
function fail(pointer: usize): usize {
  faultOffset = pointer >= sourceBase ? <u32>(pointer - sourceBase) : 0;
  return 0;
}

@inline
function allocateGraph(size: usize, alignment: usize = 8): usize {
  const pointer = (graphCursor + alignment - 1) & ~(alignment - 1);
  const next = pointer + size;
  if (next < pointer || next > graphLimit) {
    faultOffset = <u32>(graphCursor - sourceBase);
    return 0;
  }
  graphCursor = next;
  return pointer;
}

@inline
function stringNext(result: u64): usize {
  return <usize>(result >> 32);
}

function parseValue(
  cursor: usize,
  end: usize,
  slot: usize,
  depth: u32,
): usize {
  if (depth > 256) return fail(cursor);
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end) return fail(cursor);
  const token = load<u8>(cursor);

  if (
    token == 0x6e &&
    end - cursor >= 4 &&
    load<u32>(cursor) == 0x6c6c_756e
  ) {
    store<u32>(slot, DYNAMIC_NULL);
    return cursor + 4;
  }

  if (
    token == 0x74 &&
    end - cursor >= 4 &&
    load<u32>(cursor) == 0x6575_7274
  ) {
    store<u32>(slot, DYNAMIC_BOOLEAN);
    store<u32>(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET, 1);
    return cursor + 4;
  }
  if (
    token == 0x66 &&
    end - cursor >= 5 &&
    load<u32>(cursor) == 0x736c_6166 &&
    load<u8>(cursor + 4) == 0x65
  ) {
    store<u32>(slot, DYNAMIC_BOOLEAN);
    store<u32>(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET, 0);
    return cursor + 5;
  }

  if (token == 0x22) {
    const scanned = scanString_SWAR(cursor, end, trustedStrings);
    if (scanned == 0) return fail(cursor);
    const next = stringNext(scanned);
    const content = cursor + 1;
    let length = <u32>(next - content - 1);
    if ((scanned & 1) != 0) length |= 0x8000_0000;
    store<u32>(slot, DYNAMIC_STRING);
    store<u32>(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET, <u32>(content - documentBase));
    store<u32>(slot + DYNAMIC_SLOT_AUX_OFFSET, length);
    return next;
  }

  if (token == 0x5b) {
    const header = allocateGraph(8, 4);
    if (header == 0) return 0;
    store<u64>(header, 0);
    store<u32>(slot, DYNAMIC_ARRAY);
    store<u32>(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET, <u32>(header - documentBase));

    let element = skipWhitespace(cursor + 1, end);
    if (element < end && load<u8>(element) == 0x5d) {
      store<u32>(slot + DYNAMIC_SLOT_AUX_OFFSET, 0);
      return element + 1;
    }
    let count: u32 = 0;
    let previous: usize = 0;
    while (element < end) {
      const entry = allocateGraph(DYNAMIC_ARRAY_ENTRY_SIZE, 8);
      if (entry == 0) return 0;
      store<u32>(entry, 0);
      if (previous == 0) store<u32>(header + 4, <u32>(entry - documentBase));
      else store<u32>(previous, <u32>(entry - documentBase));
      previous = entry;
      element = parseValue(
        element,
        end,
        entry + DYNAMIC_ARRAY_SLOT_OFFSET,
        depth + 1,
      );
      if (element == 0) return 0;
      count++;
      element = skipWhitespace(element, end);
      if (element >= end) return fail(element);
      const separator = load<u8>(element);
      if (separator == 0x5d) {
        store<u32>(header, count);
        store<u32>(slot + DYNAMIC_SLOT_AUX_OFFSET, count);
        return element + 1;
      }
      if (separator != 0x2c) return fail(element);
      element = skipWhitespace(element + 1, end);
      if (element >= end || load<u8>(element) == 0x5d) return fail(element);
    }
    return fail(element);
  }

  if (token == 0x7b) {
    const header = allocateGraph(8, 4);
    if (header == 0) return 0;
    store<u64>(header, 0);
    store<u32>(slot, DYNAMIC_OBJECT);
    store<u32>(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET, <u32>(header - documentBase));

    let member = skipWhitespace(cursor + 1, end);
    if (member < end && load<u8>(member) == 0x7d) {
      store<u32>(slot + DYNAMIC_SLOT_AUX_OFFSET, 0);
      return member + 1;
    }
    let count: u32 = 0;
    let previous: usize = 0;
    while (member < end) {
      const entry = allocateGraph(DYNAMIC_ENTRY_SIZE, 8);
      if (entry == 0) return 0;
      store<u32>(entry + DYNAMIC_ENTRY_NEXT_OFFSET, 0);
      if (previous == 0) store<u32>(header + 4, <u32>(entry - documentBase));
      else store<u32>(previous + DYNAMIC_ENTRY_NEXT_OFFSET, <u32>(entry - documentBase));
      previous = entry;
      if (member >= end || load<u8>(member) != 0x22) return fail(member);
      const scanned = scanString_SWAR(member, end, trustedStrings);
      if (scanned == 0) return fail(member);
      const next = stringNext(scanned);
      const content = member + 1;
      let length = <u32>(next - content - 1);
      if ((scanned & 1) != 0) length |= 0x8000_0000;
      store<u32>(entry, <u32>(content - documentBase));
      store<u32>(entry + 4, length);

      member = skipWhitespace(next, end);
      if (member >= end || load<u8>(member) != 0x3a) return fail(member);
      member = parseValue(member + 1, end, entry + DYNAMIC_ENTRY_SLOT_OFFSET, depth + 1);
      if (member == 0) return 0;
      count++;
      member = skipWhitespace(member, end);
      if (member >= end) return fail(member);
      const separator = load<u8>(member);
      if (separator == 0x7d) {
        store<u32>(header, count);
        store<u32>(slot + DYNAMIC_SLOT_AUX_OFFSET, count);
        return member + 1;
      }
      if (separator != 0x2c) return fail(member);
      member = skipWhitespace(member + 1, end);
      if (member >= end || load<u8>(member) == 0x7d) return fail(member);
    }
    return fail(member);
  }

  const next = deserializeFloat_SWAR(cursor, end, slot + DYNAMIC_SLOT_PAYLOAD_OFFSET);
  if (next == 0) return fail(cursor);
  store<u32>(slot, DYNAMIC_NUMBER);
  return next;
}

/**
 * Parse a document source already resident inside `document`.
 *
 * The caller owns the document allocation and passes the root slot and graph
 * bounds. Success returns `(parsedEnd << 32) | usedDocumentBytes`; failure
 * returns zero and exposes a deterministic source-relative fault offset.
 */
export function deserializeDynamicDocument_SWAR(
  sourceStart: usize,
  end: usize,
  document: usize,
  root: usize,
  graphStart: usize,
  graphEnd: usize,
  trusted: bool = false,
): u64 {
  documentBase = document;
  sourceBase = sourceStart;
  graphCursor = graphStart;
  graphLimit = graphEnd;
  trustedStrings = trusted;
  faultOffset = 0;
  const parsed = parseValue(sourceStart, end, root, 0);
  if (parsed == 0) return 0;
  const trailing = skipWhitespace(parsed, end);
  if (trailing != end) {
    fail(trailing);
    return 0;
  }
  return (<u64>parsed << 32) | <u64>(graphCursor - documentBase);
}

export function lastDocumentFaultOffset(): u32 {
  return faultOffset;
}

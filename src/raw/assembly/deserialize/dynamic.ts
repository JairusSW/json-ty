// Opt-in unknown-shape JSON graph parser. Typed schemas do not retain this code
// when the dynamic exports are excluded from a future target profile.

import { allocateDocument, failResult, releaseDocument, resetResult, setResultRoot } from "../runtime";
import { DYNAMIC_ARRAY, DYNAMIC_BOOLEAN, DYNAMIC_ENTRY_SIZE, DYNAMIC_NULL, DYNAMIC_NUMBER, DYNAMIC_OBJECT, DYNAMIC_SLOT_SIZE, DYNAMIC_STRING } from "../layout/dynamic";
import { storeDocumentHeader } from "../layout/document";
import { inspectArray } from "./array";
import { deserializeBoolean } from "./boolean";
import { deserializeF64 } from "./number";
import { deserializeNull } from "./null";
import { align8, countObjectMembers, lastStringHadEscape, scanStringContent, setStringInputTrusted, skipWhitespace } from "./scanner";
import { deserializeString } from "./string";

let documentBase: usize = 0;
let sourceBase: usize = 0;
let graphCursor: usize = 0;
let graphLimit: usize = 0;
let faultOffset: u32 = 0;

@inline
function allocateGraph(size: usize, alignment: usize = 8): usize {
  const pointer = (graphCursor + alignment - 1) & ~(alignment - 1);
  const next = pointer + size;
  if (next < pointer || next > graphLimit) {
    faultOffset = <u32>(graphCursor - sourceBase);
    return 0;
  }
  graphCursor = next;
  memory.fill(pointer, 0, size);
  return pointer;
}

@inline
function failAt(pointer: usize): usize {
  faultOffset = <u32>(pointer - sourceBase);
  return 0;
}

function parseDynamicValue(cursor: usize, end: usize, slot: usize, depth: u32): usize {
  if (depth > 256) return failAt(cursor);
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end) return failAt(cursor);
  const token = load<u8>(cursor);
  if (token == 0x6e) {
    const next = deserializeNull(cursor, end);
    if (next == 0) return failAt(cursor);
    store<u32>(slot, DYNAMIC_NULL);
    return next;
  }
  if (token == 0x74 || token == 0x66) {
    const next = deserializeBoolean(cursor, end, slot + 8);
    if (next == 0) return failAt(cursor);
    store<u32>(slot, DYNAMIC_BOOLEAN);
    return next;
  }
  if (token == 0x22) {
    const next = deserializeString(cursor, end, slot + 8, documentBase);
    if (next == 0) return failAt(cursor);
    store<u32>(slot, DYNAMIC_STRING);
    return next;
  }
  if (token == 0x5b) {
    const counted = inspectArray(cursor, end);
    if (counted == 0) return failAt(cursor);
    const count = <u32>counted;
    const header = allocateGraph(8, 4);
    const slots = allocateGraph(<usize>count * DYNAMIC_SLOT_SIZE, 8);
    if (header == 0 || (count != 0 && slots == 0)) return 0;
    store<u32>(header, count);
    store<u32>(header + 4, <u32>(slots - documentBase));
    store<u32>(slot, DYNAMIC_ARRAY);
    store<u32>(slot + 8, <u32>(header - documentBase));
    store<u32>(slot + 12, count);
    let element = skipWhitespace(cursor + 1, end);
    for (let index: u32 = 0; index < count; index++) {
      element = parseDynamicValue(element, end, slots + <usize>index * DYNAMIC_SLOT_SIZE, depth + 1);
      if (element == 0) return 0;
      element = skipWhitespace(element, end);
      if (index + 1 < count) {
        if (element >= end || load<u8>(element) != 0x2c) return failAt(element);
        element = skipWhitespace(element + 1, end);
      }
    }
    if (element >= end || load<u8>(element) != 0x5d) return failAt(element);
    return element + 1;
  }
  if (token == 0x7b) {
    const counted = countObjectMembers(cursor, end);
    if (counted == 0) return failAt(cursor);
    const count = <u32>counted;
    const header = allocateGraph(8, 4);
    const entries = allocateGraph(<usize>count * DYNAMIC_ENTRY_SIZE, 8);
    if (header == 0 || (count != 0 && entries == 0)) return 0;
    store<u32>(header, count);
    store<u32>(header + 4, <u32>(entries - documentBase));
    store<u32>(slot, DYNAMIC_OBJECT);
    store<u32>(slot + 8, <u32>(header - documentBase));
    store<u32>(slot + 12, count);
    let member = skipWhitespace(cursor + 1, end);
    for (let index: u32 = 0; index < count; index++) {
      const entry = entries + <usize>index * DYNAMIC_ENTRY_SIZE;
      if (member >= end || load<u8>(member) != 0x22) return failAt(member);
      const keyContent = member + 1;
      const keyQuote = scanStringContent(keyContent, end);
      if (keyQuote == 0) return failAt(member);
      store<u32>(entry, <u32>(keyContent - documentBase));
      let keyLength = <u32>(keyQuote - keyContent);
      if (lastStringHadEscape()) keyLength |= 0x80000000;
      store<u32>(entry + 4, keyLength);
      member = skipWhitespace(keyQuote + 1, end);
      if (member >= end || load<u8>(member) != 0x3a) return failAt(member);
      member = parseDynamicValue(member + 1, end, entry + 8, depth + 1);
      if (member == 0) return 0;
      member = skipWhitespace(member, end);
      if (index + 1 < count) {
        if (member >= end || load<u8>(member) != 0x2c) return failAt(member);
        member = skipWhitespace(member + 1, end);
      }
    }
    if (member >= end || load<u8>(member) != 0x7d) return failAt(member);
    return member + 1;
  }

  const numberEnd = deserializeF64(cursor, end, slot + 8);
  if (numberEnd == 0) return failAt(cursor);
  store<u32>(slot, DYNAMIC_NUMBER);
  return numberEnd;
}

function parseDynamicCore(source: u32, length: u32, trustedStringInput: bool): u32 {
  resetResult();
  setStringInputTrusted(trustedStringInput);
  if (length > 0x0fffffff) return failResult(3, 0, length);
  const sourceOffset: usize = 16;
  const rootOffset = align8(sourceOffset + <usize>length);
  const capacity = rootOffset + 1040 + <usize>length * 16;
  const allocated = allocateDocument(<u32>capacity);
  if (allocated == 0) return 0;
  documentBase = <usize>allocated;
  sourceBase = documentBase + sourceOffset;
  graphCursor = documentBase + rootOffset + DYNAMIC_SLOT_SIZE;
  graphLimit = documentBase + capacity;
  faultOffset = 0;
  storeDocumentHeader(documentBase, <u32>capacity, <u32>sourceOffset, length, <u32>rootOffset);
  memory.copy(sourceBase, <usize>source, length);
  const parsedEnd = parseDynamicValue(sourceBase, sourceBase + length, documentBase + rootOffset, 0);
  if (parsedEnd == 0) {
    releaseDocument(allocated);
    return failResult(16, faultOffset, 0);
  }
  const trailing = skipWhitespace(parsedEnd, sourceBase + length);
  if (trailing != sourceBase + length) {
    releaseDocument(allocated);
    return failResult(20, <u32>(trailing - sourceBase), 0);
  }
  store<u32>(documentBase, <u32>(graphCursor - documentBase));
  setResultRoot(<u32>rootOffset);
  return allocated;
}

export function parseDynamic(source: u32, length: u32): u32 {
  return parseDynamicCore(source, length, false);
}

export function parseDynamicTrusted(source: u32, length: u32): u32 {
  return parseDynamicCore(source, length, true);
}

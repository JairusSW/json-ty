// Opt-in unknown-shape JSON graph parser. Typed schemas do not retain this code
// when the dynamic exports are excluded from a future target profile.

import { allocateGrowableDocument, failResult, growDocument, releaseDocument, reserveDocument, resetResult, setResultRoot } from "../runtime";
import { DYNAMIC_ARRAY, DYNAMIC_ARRAY_ENTRY_SIZE, DYNAMIC_ARRAY_SLOT_OFFSET, DYNAMIC_BOOLEAN, DYNAMIC_DOCUMENT_HEADER_SIZE, DYNAMIC_ENTRY_NEXT_OFFSET, DYNAMIC_ENTRY_SIZE, DYNAMIC_ENTRY_SLOT_OFFSET, DYNAMIC_GRAPH_CURSOR_OFFSET, DYNAMIC_GRAPH_LIMIT_OFFSET, DYNAMIC_LAZY_ARRAY, DYNAMIC_LAZY_OBJECT, DYNAMIC_NULL, DYNAMIC_NUMBER, DYNAMIC_OBJECT, DYNAMIC_SLOT_AUX_OFFSET, DYNAMIC_SLOT_PAYLOAD_OFFSET, DYNAMIC_SLOT_SIZE, DYNAMIC_STRING } from "../layout/dynamic";
import { markDocumentSourceCandidate, storeDocumentHeader } from "../layout/document";
import { deserializeBoolean } from "./boolean";
import { deserializeF64 } from "./number";
import { deserializeNull } from "./null";
import { align8, beginDynamicGraphEstimate, endDynamicGraphEstimate, inputWasMinified, lastStringHadEscape, scanStringContent, setStringInputTrusted, skipValueMinified, skipValueMinifiedTrusted, skipWhitespace } from "./scanner";
import { deserializeString } from "./string";

let documentBase: usize = 0;
let sourceBase: usize = 0;
let graphCursor: usize = 0;
let graphLimit: usize = 0;
let faultOffset: u32 = 0;
let sourceValidated: bool = false;
let deferNestedContainers: bool = true;

@inline
function allocateGraph(size: usize, alignment: usize = 8): usize {
  const pointer = (graphCursor + alignment - 1) & ~(alignment - 1);
  const next = pointer + size;
  if (next < pointer) {
    faultOffset = <u32>(graphCursor - sourceBase);
    return 0;
  }
  if (next > graphLimit) {
    const capacity = growDocument(
      <u32>documentBase,
      <u32>(next - documentBase),
    );
    if (capacity == 0) {
      faultOffset = <u32>(graphCursor - sourceBase);
      return 0;
    }
    graphLimit = documentBase + <usize>capacity;
    store<u32>(
      documentBase + DYNAMIC_GRAPH_LIMIT_OFFSET,
      capacity,
    );
  }
  graphCursor = next;
  return pointer;
}

@inline
function failAt(pointer: usize): usize {
  faultOffset = <u32>(pointer - sourceBase);
  return 0;
}

@inline
function deferComposite(cursor: usize, end: usize, slot: usize, tag: u32): usize {
  // Initial parsing uses the exact recursive scanner so malformed nested JSON
  // still fails immediately. Once the document is known-valid, materializing a
  // child only needs the json-as-shaped value-boundary scanner.
  const next = sourceValidated
    ? skipValueMinifiedTrusted(cursor, end)
    : skipValueMinified(cursor, end);
  if (next == 0) return failAt(cursor);
  store<u32>(slot, tag);
  store<u32>(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET, <u32>(cursor - documentBase));
  store<u32>(slot + DYNAMIC_SLOT_AUX_OFFSET, <u32>(next - cursor));
  return next;
}

function parseDynamicValue(
  cursor: usize,
  end: usize,
  slot: usize,
  depth: u32,
  deferContainers: bool,
): usize {
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
    const next = deserializeBoolean(cursor, end, slot + DYNAMIC_SLOT_PAYLOAD_OFFSET);
    if (next == 0) return failAt(cursor);
    store<u32>(slot, DYNAMIC_BOOLEAN);
    return next;
  }
  if (token == 0x22) {
    const next = deserializeString(cursor, end, slot + DYNAMIC_SLOT_PAYLOAD_OFFSET, documentBase);
    if (next == 0) return failAt(cursor);
    store<u32>(slot, DYNAMIC_STRING);
    return next;
  }
  if (token == 0x5b) {
    if (deferContainers) {
      return deferComposite(cursor, end, slot, DYNAMIC_LAZY_ARRAY);
    }
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
      element = parseDynamicValue(
        element,
        end,
        entry + DYNAMIC_ARRAY_SLOT_OFFSET,
        depth + 1,
        deferNestedContainers,
      );
      if (element == 0) return 0;
      count++;
      element = skipWhitespace(element, end);
      if (element >= end) return failAt(element);
      const separator = load<u8>(element);
      if (separator == 0x5d) {
        store<u32>(header, count);
        store<u32>(slot + DYNAMIC_SLOT_AUX_OFFSET, count);
        return element + 1;
      }
      if (separator != 0x2c) return failAt(element);
      element = skipWhitespace(element + 1, end);
      if (element >= end || load<u8>(element) == 0x5d) return failAt(element);
    }
    return failAt(element);
  }
  if (token == 0x7b) {
    if (deferContainers) {
      return deferComposite(cursor, end, slot, DYNAMIC_LAZY_OBJECT);
    }
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
      member = parseDynamicValue(
        member + 1,
        end,
        entry + DYNAMIC_ENTRY_SLOT_OFFSET,
        depth + 1,
        deferNestedContainers,
      );
      if (member == 0) return 0;
      count++;
      member = skipWhitespace(member, end);
      if (member >= end) return failAt(member);
      const separator = load<u8>(member);
      if (separator == 0x7d) {
        store<u32>(header, count);
        store<u32>(slot + DYNAMIC_SLOT_AUX_OFFSET, count);
        return member + 1;
      }
      if (separator != 0x2c) return failAt(member);
      member = skipWhitespace(member + 1, end);
      if (member >= end || load<u8>(member) == 0x7d) return failAt(member);
    }
    return failAt(member);
  }

  const numberEnd = deserializeF64(cursor, end, slot + DYNAMIC_SLOT_PAYLOAD_OFFSET);
  if (numberEnd == 0) return failAt(cursor);
  store<u32>(slot, DYNAMIC_NUMBER);
  return numberEnd;
}

function parseDynamicCore(
  source: u32,
  length: u32,
  trustedStringInput: bool,
  eager: bool,
): u32 {
  resetResult();
  setStringInputTrusted(trustedStringInput);
  if (length > 0x0fffffff) return failResult(3, 0, length);
  const sourceOffset: usize = DYNAMIC_DOCUMENT_HEADER_SIZE;
  // Place the packed root at +4 mod 8 so its payload and the following graph
  // cursor are both naturally 8-byte aligned.
  const rootOffset = align8(sourceOffset + <usize>length) + 4;
  // Source bytes already occupy rootOffset. Seed only a quarter source-length
  // for eager graph data; the wilderness arena grows for denser shapes.
  // Lazy keeps a larger seed because its root is built before deferred sizing.
  const graphSeed = eager ? <usize>(length >> 2) : <usize>length;
  const graphOverhead: usize = eager ? 64 : 1040;
  const capacity = rootOffset + graphOverhead + graphSeed;
  const allocated = allocateGrowableDocument(<u32>capacity);
  if (allocated == 0) return 0;
  documentBase = <usize>allocated;
  sourceBase = documentBase + sourceOffset;
  graphCursor = documentBase + rootOffset + DYNAMIC_SLOT_SIZE;
  graphLimit = documentBase + capacity;
  faultOffset = 0;
  sourceValidated = false;
  deferNestedContainers = !eager;
  if (!eager) beginDynamicGraphEstimate();
  storeDocumentHeader(documentBase, <u32>capacity, <u32>sourceOffset, length, <u32>rootOffset);
  store<u32>(documentBase + DYNAMIC_GRAPH_LIMIT_OFFSET, <u32>capacity);
  memory.copy(sourceBase, <usize>source, length);
  const parsedEnd = parseDynamicValue(
    sourceBase,
    sourceBase + length,
    documentBase + rootOffset,
    0,
    false,
  );
  const deferredGraphBytes: u32 = eager ? 0 : endDynamicGraphEstimate();
  if (parsedEnd == 0) {
    releaseDocument(allocated);
    return failResult(16, faultOffset, 0);
  }
  const minifiedValue = inputWasMinified();
  const trailing = skipWhitespace(parsedEnd, sourceBase + length);
  if (trailing != sourceBase + length) {
    releaseDocument(allocated);
    return failResult(20, <u32>(trailing - sourceBase), 0);
  }
  // Trailing RFC whitespace is not part of the retained JSON value. Preserve
  // whether the value itself was minified before skipWhitespace observes a
  // final newline, so the serializer can verify and promote the exact prefix.
  store<u32>(documentBase + 8, <u32>(parsedEnd - sourceBase));
  store<u32>(documentBase, <u32>(graphCursor - documentBase));
  store<u32>(
    documentBase + DYNAMIC_GRAPH_CURSOR_OFFSET,
    <u32>(graphCursor - documentBase),
  );
  if (deferredGraphBytes != 0) {
    const required = <u32>(graphCursor - documentBase) + deferredGraphBytes;
    if (required < deferredGraphBytes) {
      releaseDocument(allocated);
      return failResult(3, 0, required);
    }
    const reserved = reserveDocument(allocated, required);
    if (reserved == 0) {
      releaseDocument(allocated);
      return 0;
    }
    graphLimit = documentBase + <usize>reserved;
    store<u32>(documentBase + DYNAMIC_GRAPH_LIMIT_OFFSET, reserved);
  }
  if (minifiedValue) markDocumentSourceCandidate(documentBase);
  setResultRoot(<u32>rootOffset);
  return allocated;
}

export function parseDynamic(source: u32, length: u32): u32 {
  return parseDynamicCore(source, length, false, false);
}

export function parseDynamicTrusted(source: u32, length: u32): u32 {
  return parseDynamicCore(source, length, true, false);
}

export function parseDynamicEager(source: u32, length: u32): u32 {
  return parseDynamicCore(source, length, false, true);
}

export function parseDynamicEagerTrusted(source: u32, length: u32): u32 {
  return parseDynamicCore(source, length, true, true);
}

/**
 * Build one previously deferred container in the document's reserved arena.
 * The complete source was validated by parseDynamicCore, so descendants may
 * retain boundary-only spans without rescanning their grammar.
 */
export function materializeDynamic(document: u32, slot: u32): u32 {
  const base = <usize>document;
  const target = <usize>slot;
  const tag = load<u32>(target);
  if (tag != DYNAMIC_LAZY_ARRAY && tag != DYNAMIC_LAZY_OBJECT) return tag;

  documentBase = base;
  sourceBase = base + <usize>load<u32>(base + 4);
  graphCursor =
    base + <usize>load<u32>(base + DYNAMIC_GRAPH_CURSOR_OFFSET);
  graphLimit = base + <usize>load<u32>(base + DYNAMIC_GRAPH_LIMIT_OFFSET);
  faultOffset = 0;
  sourceValidated = true;
  deferNestedContainers = true;

  const start = base + <usize>load<u32>(target + DYNAMIC_SLOT_PAYLOAD_OFFSET);
  const end = start + <usize>load<u32>(target + DYNAMIC_SLOT_AUX_OFFSET);
  const parsed = parseDynamicValue(start, end, target, 0, false);
  sourceValidated = false;
  if (parsed != end) return 0;

  store<u32>(base, <u32>(graphCursor - base));
  store<u32>(
    base + DYNAMIC_GRAPH_CURSOR_OFFSET,
    <u32>(graphCursor - base),
  );
  return load<u32>(target);
}

function materializeDynamicTreeSlot(
  document: usize,
  slot: usize,
  depth: u32,
): bool {
  if (depth > 256) return false;
  let tag = load<u32>(slot);
  if (tag == DYNAMIC_LAZY_ARRAY || tag == DYNAMIC_LAZY_OBJECT) {
    tag = materializeDynamic(<u32>document, <u32>slot);
    if (tag == 0) return false;
  }
  if (tag != DYNAMIC_ARRAY && tag != DYNAMIC_OBJECT) return true;

  const header = document + <usize>load<u32>(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET);
  const length = load<u32>(header);
  let entry = document + <usize>load<u32>(header + 4);
  for (let index: u32 = 0; index < length; index++) {
    if (entry == document) return false;
    const child = entry + (
      tag == DYNAMIC_ARRAY
        ? DYNAMIC_ARRAY_SLOT_OFFSET
        : DYNAMIC_ENTRY_SLOT_OFFSET
    );
    if (!materializeDynamicTreeSlot(document, child, depth + 1)) return false;
    entry = document + <usize>load<u32>(
      entry + (tag == DYNAMIC_ARRAY ? 0 : DYNAMIC_ENTRY_NEXT_OFFSET),
    );
  }
  return true;
}

/** Materialize an entire validated dynamic subtree in one Wasm boundary call. */
export function materializeDynamicTree(document: u32, slot: u32): u32 {
  return materializeDynamicTreeSlot(<usize>document, <usize>slot, 0) ? 1 : 0;
}

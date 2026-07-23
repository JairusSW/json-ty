import { materializeDynamic } from "../deserialize/dynamic";
import { DYNAMIC_ARRAY, DYNAMIC_ARRAY_SLOT_OFFSET, DYNAMIC_BOOLEAN, DYNAMIC_ENTRY_NEXT_OFFSET, DYNAMIC_ENTRY_SLOT_OFFSET, DYNAMIC_LAZY_ARRAY, DYNAMIC_LAZY_OBJECT, DYNAMIC_NULL, DYNAMIC_NUMBER, DYNAMIC_OBJECT, DYNAMIC_SLOT_AUX_OFFSET, DYNAMIC_SLOT_PAYLOAD_OFFSET, DYNAMIC_STRING } from "../layout/dynamic";
import { clearDocumentSourceCandidate, documentRoot, documentSource, documentSourceEquals, documentSourceIsCandidate, documentSourceIsCanonical, documentSourceLength, markDocumentSourceCanonical } from "../layout/document";
import { failResult, resetResult, setResultOutput } from "../runtime";
import { beginArray, endArray, nextArrayElement } from "./array";
import { serializeBoolean } from "./boolean";
import { serializeF64 } from "./number";
import { serializeNull } from "./null";
import { beginStruct, endStruct, nextStructField } from "./struct";
import { serializeStringSpan } from "./string";
import { beginWriter, finishWriter, requiredWriterCapacity, writeByte, writePacked, writeRaw } from "./writer";

function serializeDynamicSlot(slot: usize, document: usize, depth: u32): bool {
  if (depth > 256) return false;
  let tag = load<u32>(slot);
  if (tag == DYNAMIC_LAZY_ARRAY || tag == DYNAMIC_LAZY_OBJECT) {
    tag = materializeDynamic(<u32>document, <u32>slot);
    if (tag == 0) return false;
  }
  if (tag == DYNAMIC_NULL) return serializeNull();
  if (tag == DYNAMIC_BOOLEAN) return serializeBoolean(load<u32>(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET));
  if (tag == DYNAMIC_NUMBER) return serializeF64(load<f64>(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET));
  if (tag == DYNAMIC_STRING) return serializeStringSpan(document, load<u32>(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET), load<u32>(slot + DYNAMIC_SLOT_AUX_OFFSET));

  const header = document + load<u32>(slot + DYNAMIC_SLOT_PAYLOAD_OFFSET);
  const length = load<u32>(header);
  const data = document + load<u32>(header + 4);
  if (tag == DYNAMIC_ARRAY) {
    if (!beginArray()) return false;
    let entry = data;
    for (let index: u32 = 0; index < length; index++) {
      if (!nextArrayElement(index)) return false;
      if (entry == document || !serializeDynamicSlot(entry + DYNAMIC_ARRAY_SLOT_OFFSET, document, depth + 1)) return false;
      entry = document + load<u32>(entry);
    }
    return endArray();
  }
  if (tag == DYNAMIC_OBJECT) {
    if (!beginStruct()) return false;
    let wrote = false;
    let entry = data;
    for (let index: u32 = 0; index < length; index++) {
      if (!nextStructField(wrote)) return false;
      if (entry == document) return false;
      const keyOffset = load<u32>(entry);
      const keyLength = load<u32>(entry + 4) & 0x3fffffff;
      if (!writeByte(0x22) || !writeRaw(<u32>(document + keyOffset), keyLength) || !writePacked(0x3a22, 2)) return false;
      if (!serializeDynamicSlot(entry + DYNAMIC_ENTRY_SLOT_OFFSET, document, depth + 1)) return false;
      entry = document + load<u32>(entry + DYNAMIC_ENTRY_NEXT_OFFSET);
      wrote = true;
    }
    return endStruct();
  }
  return false;
}

export function serializeDynamic(documentPointer: u32, output: u32, capacity: u32): u32 {
  resetResult();
  const document = <usize>documentPointer;
  const sourceLength = documentSourceLength(document);
  if (documentSourceIsCanonical(document)) {
    if (sourceLength > capacity) return failResult(2, 0, sourceLength);
    memory.copy(<usize>output, documentSource(document), sourceLength);
    return setResultOutput(output, sourceLength);
  }
  beginWriter(output, capacity);
  if (!serializeDynamicSlot(documentRoot(document), document, 0)) return failResult(2, 0, requiredWriterCapacity());
  const outputLength = finishWriter();
  if (documentSourceIsCandidate(document)) {
    if (documentSourceEquals(document, <usize>output, outputLength)) markDocumentSourceCanonical(document);
    else clearDocumentSourceCandidate(document);
  }
  return setResultOutput(output, outputLength);
}

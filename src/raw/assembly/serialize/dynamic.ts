import { DYNAMIC_ARRAY, DYNAMIC_BOOLEAN, DYNAMIC_ENTRY_SIZE, DYNAMIC_NULL, DYNAMIC_NUMBER, DYNAMIC_OBJECT, DYNAMIC_SLOT_SIZE, DYNAMIC_STRING } from "../layout/dynamic";
import { documentRoot } from "../layout/document";
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
  const tag = load<u32>(slot);
  if (tag == DYNAMIC_NULL) return serializeNull();
  if (tag == DYNAMIC_BOOLEAN) return serializeBoolean(load<u32>(slot + 8));
  if (tag == DYNAMIC_NUMBER) return serializeF64(load<f64>(slot + 8));
  if (tag == DYNAMIC_STRING) return serializeStringSpan(document, load<u32>(slot + 8), load<u32>(slot + 12));

  const header = document + load<u32>(slot + 8);
  const length = load<u32>(header);
  const data = document + load<u32>(header + 4);
  if (tag == DYNAMIC_ARRAY) {
    if (!beginArray()) return false;
    for (let index: u32 = 0; index < length; index++) {
      if (!nextArrayElement(index)) return false;
      if (!serializeDynamicSlot(data + <usize>index * DYNAMIC_SLOT_SIZE, document, depth + 1)) return false;
    }
    return endArray();
  }
  if (tag == DYNAMIC_OBJECT) {
    if (!beginStruct()) return false;
    let wrote = false;
    for (let index: u32 = 0; index < length; index++) {
      if (!nextStructField(wrote)) return false;
      const entry = data + <usize>index * DYNAMIC_ENTRY_SIZE;
      const keyOffset = load<u32>(entry);
      const keyLength = load<u32>(entry + 4) & 0x3fffffff;
      if (!writeByte(0x22) || !writeRaw(<u32>(document + keyOffset), keyLength) || !writePacked(0x3a22, 2)) return false;
      if (!serializeDynamicSlot(entry + 8, document, depth + 1)) return false;
      wrote = true;
    }
    return endStruct();
  }
  return false;
}

export function serializeDynamic(documentPointer: u32, output: u32, capacity: u32): u32 {
  resetResult();
  beginWriter(output, capacity);
  const document = <usize>documentPointer;
  if (!serializeDynamicSlot(documentRoot(document), document, 0)) return failResult(2, 0, requiredWriterCapacity());
  return setResultOutput(output, finishWriter());
}

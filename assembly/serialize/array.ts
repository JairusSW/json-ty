import { writeByte, writeF64Array } from "./writer";

export { writeF64Array as serializeF64Array };

@inline
export function beginArray(): bool {
  return writeByte(0x5b);
}

@inline
export function endArray(): bool {
  return writeByte(0x5d);
}

@inline
export function nextArrayElement(index: u32): bool {
  return index == 0 || writeByte(0x2c);
}

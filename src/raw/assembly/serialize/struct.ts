import { writeByte } from "./writer";

@inline
export function beginStruct(): bool {
  return writeByte(0x7b);
}

@inline
export function endStruct(): bool {
  return writeByte(0x7d);
}

@inline
export function nextStructField(wrote: bool): bool {
  return !wrote || writeByte(0x2c);
}

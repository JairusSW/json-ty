import { writePacked } from "./writer";

@inline
export function serializeBoolean(value: u32): bool {
  return value != 0 ? writePacked(0x65757274, 4) : writePacked(0x65736c6166, 5);
}

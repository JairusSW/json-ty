import { writePacked } from "./writer";

@inline
export function serializeNull(): bool {
  return writePacked(0x6c6c756e, 4);
}

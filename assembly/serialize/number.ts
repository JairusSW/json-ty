import { writeF64 } from "./writer";

@inline
export function serializeF64(value: f64): bool {
  return writeF64(value);
}

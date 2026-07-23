import { serializeRetainedString_NAIVE } from "./naive/string";
import {
  serializeRetainedCleanString_SIMD,
  serializeRetainedEscapedString_SIMD,
} from "./simd/string";
import {
  serializeRetainedCleanString_SWAR,
  serializeRetainedEscapedString_SWAR,
} from "./swar/string";

/** Complete compile-time selection policy for retained string serialization. */
@inline
export function serializeRetainedStringKernel(
  source: usize,
  length: u32,
  escaped: bool,
): bool {
  if (JSON_TY_KERNEL_TIER == 0) {
    return serializeRetainedString_NAIVE(source, length, escaped);
  }
  if (JSON_TY_KERNEL_TIER == 2 && ASC_FEATURE_SIMD) {
    return escaped
      ? serializeRetainedEscapedString_SIMD(source, length)
      : serializeRetainedCleanString_SIMD(source, length);
  }
  return escaped
    ? serializeRetainedEscapedString_SWAR(source, length)
    : serializeRetainedCleanString_SWAR(source, length);
}

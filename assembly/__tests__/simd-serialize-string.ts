import { serializeRetainedCleanString_SIMD, serializeRetainedEscapedString_SIMD } from "../serialize/simd/string";
import { serializeRetainedCleanString_SWAR, serializeRetainedEscapedString_SWAR } from "../serialize/swar/string";
import { beginWriter, finishWriter, requiredWriterCapacity } from "../serialize/writer";

export function begin(output: u32, capacity: u32): void {
  beginWriter(output, capacity);
}

export function finish(): u32 {
  return finishWriter();
}

export function required(): u32 {
  return requiredWriterCapacity();
}

export function serializeClean(source: usize, length: u32): bool {
  return serializeRetainedCleanString_SIMD(source, length);
}

export function serializeEscaped(source: usize, length: u32): bool {
  return serializeRetainedEscapedString_SIMD(source, length);
}

export function benchSimd(source: usize, length: u32, output: u32, capacity: u32, iterations: u32): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    beginWriter(output, capacity);
    serializeRetainedEscapedString_SIMD(source, length);
    checksum += finishWriter();
  }
  return checksum;
}

export function benchSwar(source: usize, length: u32, output: u32, capacity: u32, iterations: u32): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    beginWriter(output, capacity);
    serializeRetainedEscapedString_SWAR(source, length);
    checksum += finishWriter();
  }
  return checksum;
}

export function benchCleanSimd(source: usize, length: u32, output: u32, capacity: u32, iterations: u32): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    beginWriter(output, capacity);
    serializeRetainedCleanString_SIMD(source, length);
    checksum += finishWriter();
  }
  return checksum;
}

export function benchCleanSwar(source: usize, length: u32, output: u32, capacity: u32, iterations: u32): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    beginWriter(output, capacity);
    serializeRetainedCleanString_SWAR(source, length);
    checksum += finishWriter();
  }
  return checksum;
}

import {
  serializeCanonicalString_SWAR,
  serializeRetainedCleanString_SWAR,
  serializeRetainedEscapedString_SWAR,
  serializeString_SWAR,
} from "../serialize/swar/string";
import {
  beginWriter,
  claimWriter,
  finishWriter,
  requiredWriterCapacity,
} from "../../assembly/serialize/writer";

export function begin(output: u32, capacity: u32): void {
  beginWriter(output, capacity);
}

export function finish(): u32 {
  return finishWriter();
}

export function required(): u32 {
  return requiredWriterCapacity();
}

export function serializeRaw(source: usize, length: u32): bool {
  return serializeString_SWAR(source, length);
}

export function serializeClean(source: usize, length: u32): bool {
  return serializeRetainedCleanString_SWAR(source, length);
}

export function serializeEscaped(source: usize, length: u32): bool {
  return serializeRetainedEscapedString_SWAR(source, length);
}

export function serializeCanonical(source: usize, length: u32): bool {
  return serializeCanonicalString_SWAR(source, length);
}

@inline
function scalarLength(value: u8): u32 {
  if (
    value == 0x22 ||
    value == 0x5c ||
    value == 0x08 ||
    value == 0x09 ||
    value == 0x0a ||
    value == 0x0c ||
    value == 0x0d
  ) return 2;
  return value < 0x20 ? 6 : 1;
}

@inline
function scalarEscape(destination: usize, value: u8): usize {
  if (value == 0x22 || value == 0x5c) {
    store<u8>(destination, 0x5c);
    store<u8>(destination + 1, value);
    return destination + 2;
  }
  if (
    value == 0x08 ||
    value == 0x09 ||
    value == 0x0a ||
    value == 0x0c ||
    value == 0x0d
  ) {
    store<u8>(destination, 0x5c);
    store<u8>(
      destination + 1,
      value == 0x08
        ? 0x62
        : value == 0x09
          ? 0x74
          : value == 0x0a
            ? 0x6e
            : value == 0x0c
              ? 0x66
              : 0x72,
    );
    return destination + 2;
  }
  if (value < 0x20) {
    const high = value >> 4;
    const low = value & 15;
    store<u32>(destination, 0x3030_755c);
    store<u8>(destination + 4, <u8>(0x30 + high));
    store<u8>(destination + 5, <u8>(low < 10 ? 0x30 + low : 0x57 + low));
    return destination + 6;
  }
  store<u8>(destination, value);
  return destination + 1;
}

function serializeScalar(source: usize, length: u32): bool {
  let required: u64 = 2;
  const end = source + <usize>length;
  let pointer = source;
  while (pointer < end) required += scalarLength(load<u8>(pointer++));
  if (required > U32.MAX_VALUE) return false;
  let output = claimWriter(<u32>required);
  if (output == 0) return false;
  store<u8>(output++, 0x22);
  pointer = source;
  while (pointer < end) {
    output = scalarEscape(output, load<u8>(pointer++));
  }
  store<u8>(output, 0x22);
  return true;
}

export function benchSwar(
  source: usize,
  length: u32,
  output: u32,
  capacity: u32,
  iterations: u32,
): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    beginWriter(output, capacity);
    serializeString_SWAR(source, length);
    checksum += finishWriter();
  }
  return checksum;
}

export function benchScalar(
  source: usize,
  length: u32,
  output: u32,
  capacity: u32,
  iterations: u32,
): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    beginWriter(output, capacity);
    serializeScalar(source, length);
    checksum += finishWriter();
  }
  return checksum;
}

export function benchRetained(
  source: usize,
  length: u32,
  output: u32,
  capacity: u32,
  iterations: u32,
): u64 {
  let checksum: u64 = 0;
  for (let index: u32 = 0; index < iterations; index++) {
    beginWriter(output, capacity);
    serializeRetainedCleanString_SWAR(source, length);
    checksum += finishWriter();
  }
  return checksum;
}


// Allocation-free UTF-8 JSON writer shared by every specialized serializer.
// xjb-as produces UTF-16 ASCII digits; they are compacted directly to UTF-8.

import { dtoa_buffered } from "xjb-as/assembly/dtoa";
import { operationScratchEnd } from "../runtime";
import { writeU32 } from "./integer";

const NUMBER_SCRATCH_SIZE: usize = 128;

let writerStart: usize = 0;
let writerCursor: usize = 0;
let writerEnd: usize = 0;
let writerRequired: usize = 0;

export function beginWriter(output: u32, capacity: u32): void {
  writerStart = <usize>output;
  writerCursor = writerStart;
  writerEnd = writerStart + <usize>capacity;
  writerRequired = 0;
}


@inline
function reserve(length: usize): bool {
  const next = writerCursor + length;
  if (next <= writerEnd && next >= writerCursor) return true;
  const required = next - writerStart;
  if (required > writerRequired) writerRequired = required;
  return false;
}

/**
 * Claim one exactly-sized writer region.
 *
 * Failure records the complete required capacity and leaves the cursor and
 * output bytes untouched. Specialized kernels may then write directly inside
 * the returned bounded region without repeating reserve checks.
 */
export function claimWriter(length: u32): usize {
  const size = <usize>length;
  if (!reserve(size)) return 0;
  const claimed = writerCursor;
  writerCursor += size;
  return claimed;
}


// json-as's selected f64[] writer reserves once, emits a uniform
// number+comma loop, then overwrites the last comma with `]`. Keeping the same
// shape here removes two capacity checks and the separator branch per value.
export function writeF64Array(data: usize, length: u32): bool {
  if (length > (U32.MAX_VALUE - 2) / 25) return false;
  // Include one formatter-width tail so the last in-place UTF-16 dtoa write
  // remains bounded before it is narrowed back to its logical UTF-8 width.
  if (!reserve(50 + <usize>length * 25)) return false;

  let cursor = writerCursor;
  store<u8>(cursor, 0x5b);
  cursor++;
  if (length == 0) {
    store<u8>(cursor, 0x5d);
    writerCursor = cursor + 1;
    return true;
  }

  for (let index: u32 = 0; index < length; index++) {
    const value = load<f64>(data + (<usize>index << 3));
    const bits = reinterpret<u64>(value);
    if (((bits >> 52) & 0x7ff) == 0x7ff) {
      store<u32>(cursor, 0x6c6c756e);
      cursor += 4;
    } else if (value >= 0.0 && value <= 4_294_967_295.0 && value == <f64><u32>value) {
      cursor += writeU32(cursor, <u32>value);
    } else if (value < 0.0 && value >= -2_147_483_648.0 && value == <f64><i32>value) {
      store<u8>(cursor, 0x2d);
      cursor += 1 + writeU32(cursor + 1, <u32>-value);
    } else {
      const written = dtoa_buffered(cursor, value);
      compactUtf16Ascii(cursor, cursor, written);
      cursor += written;
    }
    store<u8>(cursor, 0x2c);
    cursor++;
  }
  store<u8>(cursor - 1, 0x5d);
  writerCursor = cursor;
  return true;
}

export function writeByte(value: u32): bool {
  if (!reserve(1)) return false;
  store<u8>(writerCursor, <u8>value);
  writerCursor++;
  return true;
}

// Writes one little-endian packed ASCII literal without touching bytes beyond
// its logical length. Codegen chunks constants into at most eight bytes.
export function writePacked(value: u64, length: u32): bool {
  const len = <usize>length;
  if (!reserve(len)) return false;
  if (length >= 8) {
    store<u64>(writerCursor, value);
  } else {
    if ((length & 4) != 0) {
      store<u32>(writerCursor, <u32>value);
      writerCursor += 4;
      value >>= 32;
    }
    if ((length & 2) != 0) {
      store<u16>(writerCursor, <u16>value);
      writerCursor += 2;
      value >>= 16;
    }
    if ((length & 1) != 0) {
      store<u8>(writerCursor, <u8>value);
      writerCursor++;
    }
    return true;
  }
  writerCursor += len;
  return true;
}

export function writeRaw(source: u32, length: u32): bool {
  const len = <usize>length;
  if (!reserve(len)) return false;
  memory.copy(writerCursor, <usize>source, len);
  writerCursor += len;
  return true;
}


@inline
function compactUtf16Ascii(source: usize, destination: usize, length: u32): void {
  let index: u32 = 0;
  if (ASC_FEATURE_SIMD) {
    while (index + 16 <= length) {
      const low = v128.load(source + (<usize>index << 1));
      const high = v128.load(source + (<usize>(index + 8) << 1));
      v128.store(destination + index, i8x16.narrow_i16x8_u(low, high));
      index += 16;
    }
    if (index + 8 <= length) {
      const block = v128.load(source + (<usize>index << 1));
      const packed = i8x16.narrow_i16x8_u(block, i16x8.splat(0));
      store<u64>(destination + index, <u64>i64x2.extract_lane(packed, 0));
      index += 8;
    }
  }
  for (; index < length; index++) {
    store<u8>(destination + index, <u8>load<u16>(source + (<usize>index << 1)));
  }
}

export function writeF64(value: f64): bool {
  const bits = reinterpret<u64>(value);
  if (((bits >> 52) & 0x7ff) == 0x7ff) return writePacked(0x6c6c756e, 4);

  // TypeScript `number` fields are f64, but JSON payloads commonly hold small
  // integers. Avoid dtoa and its UTF-16-to-UTF-8 compaction for exact u32/i32
  // values, using json-as's digit-pair width ladder directly in the output.
  if (value >= 0.0 && value <= 4_294_967_295.0 && value == <f64>(<u32>value)) {
    const integer = <u32>value;
    if (writerCursor + 10 <= writerEnd) {
      writerCursor += writeU32(writerCursor, integer);
      return true;
    }
    const temporary = <usize>operationScratchEnd() - NUMBER_SCRATCH_SIZE;
    const length = writeU32(temporary, integer);
    if (!reserve(length)) return false;
    memory.copy(writerCursor, temporary, length);
    writerCursor += length;
    return true;
  }
  if (value < 0.0 && value >= -2_147_483_648.0 && value == <f64>(<i32>value)) {
    const integer = <u32>-value;
    if (writerCursor + 11 > writerEnd) {
      const temporary = <usize>operationScratchEnd() - NUMBER_SCRATCH_SIZE;
      store<u8>(temporary, 0x2d);
      const length = 1 + writeU32(temporary + 1, integer);
      if (!reserve(length)) return false;
      memory.copy(writerCursor, temporary, length);
      writerCursor += length;
      return true;
    }
    store<u8>(writerCursor, 0x2d);
    writerCursor++;
    writerCursor += writeU32(writerCursor, integer);
    return true;
  }

  // With normal output headroom, format at the destination and compact in
  // place. Reads stay ahead of writes, so narrowing cannot clobber unread
  // UTF-16 lanes. This removes the separate per-number scratch round trip.
  if (writerCursor + 48 <= writerEnd) {
    const length = dtoa_buffered(writerCursor, value);
    compactUtf16Ascii(writerCursor, writerCursor, length);
    writerCursor += length;
    return true;
  }

  const temporary = <usize>operationScratchEnd() - NUMBER_SCRATCH_SIZE;
  const length = dtoa_buffered(temporary, value);
  if (!reserve(length)) return false;
  compactUtf16Ascii(temporary, writerCursor, length);
  writerCursor += length;
  return true;
}

export function finishWriter(): u32 {
  return <u32>(writerCursor - writerStart);
}

export function requiredWriterCapacity(): u32 {
  return <u32>writerRequired;
}

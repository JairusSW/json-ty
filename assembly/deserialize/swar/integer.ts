// Checked SWAR integer scanners over bounded UTF-8 byte spans.
//
// Stride policy:
//   exact digit runs: 16 -> 8 -> 4 -> scalar
//   unsigned cursor scan: 8 -> scalar
//   signed cursor scan: 4 -> scalar
//
// Cursor scanners validate JSON sign and leading-zero grammar and return zero
// on syntax or overflow. Values are written through an explicit destination
// pointer so the full u64/i64 range remains available.

import {
  parse4Digits_SWAR,
  parse4Digits_SWAR_Unsafe,
  parse8Digits_SWAR,
  parse8Digits_SWAR_Unsafe,
  parse16Digits_SWAR_Unsafe,
} from "../../util/swar-int";

const ASCII_MINUS: u8 = 0x2d;
const ASCII_ZERO: u8 = 0x30;
const U64_FACTOR_4: u64 = 10_000;
const U64_FACTOR_8: u64 = 100_000_000;
const U64_FACTOR_16: u64 = 10_000_000_000_000_000;

@inline
function appendWouldOverflow(
  value: u64,
  chunk: u64,
  factor: u64,
  maximum: u64,
): bool {
  return chunk > maximum || value > (maximum - chunk) / factor;
}

@inline
function firstDigit(start: usize, end: usize): bool {
  return start < end && <u32>(load<u8>(start) - ASCII_ZERO) <= 9;
}

/**
 * Parse an exact caller-validated digit span with the full stride tree.
 * Returns `U64.MAX_VALUE` on overflow.
 */
export function parseUnsignedExact_SWAR(
  start: usize,
  end: usize,
  destination: usize,
  maximum: u64 = U64.MAX_VALUE,
): bool {
  let value: u64 = 0;
  const checkOverflow = maximum != U64.MAX_VALUE || end - start >= 20;
  while (end - start >= 16) {
    const chunk = parse16Digits_SWAR_Unsafe(start);
    if (checkOverflow && appendWouldOverflow(value, chunk, U64_FACTOR_16, maximum)) {
      return false;
    }
    value = value * U64_FACTOR_16 + chunk;
    start += 16;
  }
  while (end - start >= 8) {
    const chunk = <u64>parse8Digits_SWAR_Unsafe(load<u64>(start));
    if (checkOverflow && appendWouldOverflow(value, chunk, U64_FACTOR_8, maximum)) {
      return false;
    }
    value = value * U64_FACTOR_8 + chunk;
    start += 8;
  }
  while (end - start >= 4) {
    const chunk = <u64>parse4Digits_SWAR_Unsafe(load<u32>(start));
    if (checkOverflow && appendWouldOverflow(value, chunk, U64_FACTOR_4, maximum)) {
      return false;
    }
    value = value * U64_FACTOR_4 + chunk;
    start += 4;
  }
  while (start < end) {
    const digit = <u64>(load<u8>(start) - ASCII_ZERO);
    if (
      checkOverflow &&
      (digit > maximum || value > (maximum - digit) / 10)
    ) return false;
    value = value * 10 + digit;
    start++;
  }
  store<u64>(destination, value);
  return true;
}

/**
 * Scan one JSON unsigned integer, store it, and return the first non-digit.
 * Zero is the failure sentinel.
 */
@inline
export function deserializeUnsigned_SWAR(
  start: usize,
  end: usize,
  destination: usize,
  maximum: u64 = U64.MAX_VALUE,
): usize {
  if (!firstDigit(start, end)) return 0;
  if (load<u8>(start) == ASCII_ZERO) {
    if (start + 1 < end && <u32>(load<u8>(start + 1) - ASCII_ZERO) <= 9) {
      return 0;
    }
    store<u64>(destination, 0);
    return start + 1;
  }

  let pointer = start;
  let value: u64 = 0;
  let digits: u32 = 0;
  while (end - pointer >= 8) {
    const chunk = parse8Digits_SWAR(load<u64>(pointer));
    if (chunk == U32.MAX_VALUE) break;
    if (
      (maximum != U64.MAX_VALUE || digits + 8 >= 20) &&
      appendWouldOverflow(value, chunk, U64_FACTOR_8, maximum)
    ) return 0;
    value = value * U64_FACTOR_8 + chunk;
    pointer += 8;
    digits += 8;
  }
  while (pointer < end) {
    const digit = <u64>(load<u8>(pointer) - ASCII_ZERO);
    if (digit > 9) break;
    if (
      (maximum != U64.MAX_VALUE || digits >= 19) &&
      (digit > maximum || value > (maximum - digit) / 10)
    ) return 0;
    value = value * 10 + digit;
    pointer++;
    digits++;
  }
  store<u64>(destination, value);
  return pointer;
}

/**
 * Scan one JSON signed integer, store it as i64, and return the first
 * non-digit. The negative magnitude limit includes `I64.MIN_VALUE`.
 */
@inline
export function deserializeInteger_SWAR(
  start: usize,
  end: usize,
  destination: usize,
): usize {
  let pointer = start;
  let negative = false;
  if (pointer < end && load<u8>(pointer) == ASCII_MINUS) {
    negative = true;
    pointer++;
  }
  if (!firstDigit(pointer, end)) return 0;
  if (load<u8>(pointer) == ASCII_ZERO) {
    if (pointer + 1 < end && <u32>(load<u8>(pointer + 1) - ASCII_ZERO) <= 9) {
      return 0;
    }
    store<i64>(destination, 0);
    return pointer + 1;
  }

  const maximum: u64 = negative
    ? 0x8000_0000_0000_0000
    : 0x7fff_ffff_ffff_ffff;
  let value: u64 = 0;
  let digits: u32 = 0;

  // Preserve the smaller signed scan probe. The leading minus shifts the
  // digit run into the common terminator-in-load zone for an 8-byte probe.
  while (end - pointer >= 4) {
    const chunk = parse4Digits_SWAR(load<u32>(pointer));
    if (chunk == U32.MAX_VALUE) break;
    if (
      digits + 4 >= 19 &&
      appendWouldOverflow(value, chunk, U64_FACTOR_4, maximum)
    ) return 0;
    value = value * U64_FACTOR_4 + chunk;
    pointer += 4;
    digits += 4;
  }
  while (pointer < end) {
    const digit = <u64>(load<u8>(pointer) - ASCII_ZERO);
    if (digit > 9) break;
    if (digits >= 18 && value > (maximum - digit) / 10) return 0;
    value = value * 10 + digit;
    pointer++;
    digits++;
  }
  store<i64>(destination, negative ? 0 - <i64>value : <i64>value);
  return pointer;
}

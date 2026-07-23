// UTF-8 adaptation of json-as's pair-multiply digit fold.
//
// Eight byte lanes now fit in one u64. Validation remains ahead of every
// multiply; trusted consume-to-end callers may use the Unsafe variants.

import { nonDigitMask8 } from "./swar";

const NIBBLES: u64 = 0x0f0f_0f0f_0f0f_0f0f;
const PAIRS: u64 = 0x00ff_00ff_00ff_00ff;
const QUADS: u64 = 0x0000_ffff_0000_ffff;

@inline
function fold4(block: u32): u32 {
  let digits = block & 0x0f0f_0f0f;
  digits = (digits * 10 + (digits >> 8)) & 0x00ff_00ff;
  return (digits * 100 + (digits >> 16)) & 0xffff;
}

/** Parse four ASCII digits, or return `U32.MAX_VALUE` on a non-digit. */
@inline
export function parse4Digits_SWAR(block: u32): u32 {
  const digits = block - 0x3030_3030;
  if (((digits | (block + 0x4646_4646)) & 0x8080_8080) != 0) {
    return U32.MAX_VALUE;
  }
  return fold4(block);
}

/** Parse four caller-validated ASCII digits. */
@inline
export function parse4Digits_SWAR_Unsafe(block: u32): u32 {
  return fold4(block);
}

@inline
function fold8(block: u64): u32 {
  let digits = block & NIBBLES;
  digits = (digits * 10 + (digits >> 8)) & PAIRS;
  digits = (digits * 100 + (digits >> 16)) & QUADS;
  return <u32>((digits * 10_000 + (digits >> 32)) & 0xffff_ffff);
}

/** Parse eight ASCII digits, or return `U32.MAX_VALUE` on a non-digit. */
@inline
export function parse8Digits_SWAR(block: u64): u32 {
  if (nonDigitMask8(block) != 0) return U32.MAX_VALUE;
  return fold8(block);
}

/** Parse eight caller-validated ASCII digits. */
@inline
export function parse8Digits_SWAR_Unsafe(block: u64): u32 {
  return fold8(block);
}

/**
 * Parse sixteen bytes with two independent 8-digit folds and one final
 * multiply-add. The explicit end pointer makes both u64 loads bounded.
 */
@inline
export function parse16Digits_SWAR(
  start: usize,
  end: usize,
): u64 {
  if (end - start < 16) return U64.MAX_VALUE;
  const first = load<u64>(start);
  const second = load<u64>(start, 8);
  if ((nonDigitMask8(first) | nonDigitMask8(second)) != 0) {
    return U64.MAX_VALUE;
  }
  return <u64>fold8(first) * 100_000_000 + <u64>fold8(second);
}

/** Parse sixteen caller-bounded, caller-validated ASCII digits. */
@inline
export function parse16Digits_SWAR_Unsafe(start: usize): u64 {
  return <u64>fold8(load<u64>(start)) * 100_000_000 +
    <u64>fold8(load<u64>(start, 8));
}


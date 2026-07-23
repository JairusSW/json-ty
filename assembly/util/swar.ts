// UTF-8 byte-lane adaptation of json-as's SWAR primitives.
//
// Packed words use Wasm's little-endian memory order: byte zero is the
// least-significant byte. Candidate masks put each hit in that byte's high bit.

const BYTE_ONES: u64 = 0x0101_0101_0101_0101;
const BYTE_HIGH: u64 = 0x8080_8080_8080_8080;

/**
 * Load up to eight bytes without reading at or beyond `end`.
 *
 * A full word keeps json-as's single-load fast path. The scalar tail is
 * zero-padded in the high lanes, so callers must bound candidate masks by the
 * original byte count.
 */
@inline
export function loadU64Bounded(start: usize, end: usize): u64 {
  const remaining = end - start;
  if (remaining >= 8) return load<u64>(start);

  let word: u64 = 0;
  let lane: usize = 0;
  while (lane < remaining) {
    word |= <u64>load<u8>(start + lane) << <i32>(lane << 3);
    lane++;
  }
  return word;
}

/**
 * Return high-bit candidates for bytes equal to `value`.
 *
 * This is json-as's subtract-and-mask equality primitive narrowed from UTF-16
 * lanes to bytes. Borrow propagation can mark a lane after a true hit, so each
 * candidate is confirmed scalarly before semantic use.
 */
@inline
export function byteEqCandidates(word: u64, value: u8): u64 {
  const splat = BYTE_ONES * <u64>value;
  const xor = word ^ splat;
  return (xor - BYTE_ONES) & ~xor & BYTE_HIGH;
}

/** Return high bits for bytes outside ASCII `0..9`. */
@inline
export function nonDigitMask8(word: u64): u64 {
  const digits = word - 0x3030_3030_3030_3030;
  return (digits | (word + 0x4646_4646_4646_4646)) & BYTE_HIGH;
}

/**
 * Decode four ASCII hex bytes packed as `0x44332211` memory order.
 *
 * The input must already be validated as `0-9`, `A-F`, or `a-f`.
 * Operation order matches json-as's nibble-plus-alpha-adjust transform.
 */
@inline
export function hex4_to_u16_swar(block: u32): u16 {
  const nibbles =
    (block & 0x0f0f_0f0f) + ((block >> 6) & 0x0303_0303) * 9;
  return <u16>(
    ((nibbles & 0xff) << 12) |
    (((nibbles >> 8) & 0xff) << 8) |
    (((nibbles >> 16) & 0xff) << 4) |
    (nibbles >> 24)
  );
}

/**
 * Encode a `u16` as four lowercase ASCII hex bytes in little-endian memory
 * order. For example, `0x1234` becomes the word `0x34333231` ("1234").
 */
@inline
export function u16_to_hex4_swar(code: u16): u32 {
  let block =
    <u32>((code >> 12) & 0xf) |
    (<u32>((code >> 8) & 0xf) << 8) |
    (<u32>((code >> 4) & 0xf) << 16) |
    (<u32>(code & 0xf) << 24);
  const alpha =
    ((block + 0x0606_0606) >> 4) & 0x0101_0101;
  return block + 0x3030_3030 + alpha * 39;
}


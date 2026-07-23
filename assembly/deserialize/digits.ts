// Packed ASCII digit kernels adapted from json-as for raw UTF-8 input.
// Unlike json-as's UTF-16 lanes, every byte is a digit lane here, so four
// digits need one u32 load. The short SWAR stride also works in scalar builds.

const ASCII_ZERO_4: u32 = 0x30303030;
const ASCII_RANGE_4: u32 = 0x46464646;
const ASCII_HIGH_4: u32 = 0x80808080;

// Parses four UTF-8 ASCII digits packed little-endian in a u32. The range
// check and pair-multiply tree are the same operations used by json-as's
// fastest SWAR integer/float scanners, narrowed from UTF-16 to byte lanes.
@inline
export function parse4Digits(block: u32): u32 {
  const digits = block - ASCII_ZERO_4;
  if ((((block + ASCII_RANGE_4) | digits) & ASCII_HIGH_4) != 0) return U32.MAX_VALUE;
  const pairs = (digits * 10 + (digits >> 8)) & 0x00ff00ff;
  return (pairs * 100 + (pairs >> 16)) & 0xffff;
}

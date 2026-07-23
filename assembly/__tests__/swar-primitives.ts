import {
  byteEqCandidates,
  hex4_to_u16_swar,
  loadU64Bounded,
  nonDigitMask8,
  u16_to_hex4_swar,
} from "../util/swar";
import {
  parse8Digits_SWAR,
  parse16Digits_SWAR,
} from "../util/swar-int";

export function bounded(start: usize, end: usize): u64 {
  return loadU64Bounded(start, end);
}

export function equals(word: u64, value: u8): u64 {
  return byteEqCandidates(word, value);
}

export function nondigits(word: u64): u64 {
  return nonDigitMask8(word);
}

export function decodeHex(word: u32): u32 {
  return hex4_to_u16_swar(word);
}

export function encodeHex(value: u32): u32 {
  return u16_to_hex4_swar(<u16>value);
}

export function parse8(word: u64): u32 {
  return parse8Digits_SWAR(word);
}

export function parse16(start: usize, end: usize): u64 {
  return parse16Digits_SWAR(start, end);
}

export function benchParse8(start: usize, count: u32, rounds: u32): u64 {
  let sum: u64 = 0;
  for (let round: u32 = 0; round < rounds; round++) {
    let pointer = start;
    for (let index: u32 = 0; index < count; index++) {
      sum += parse8Digits_SWAR(load<u64>(pointer));
      pointer += 8;
    }
  }
  return sum;
}

export function benchScalar8(start: usize, count: u32, rounds: u32): u64 {
  let sum: u64 = 0;
  for (let round: u32 = 0; round < rounds; round++) {
    let pointer = start;
    for (let index: u32 = 0; index < count; index++) {
      let value: u32 = 0;
      for (let lane: usize = 0; lane < 8; lane++) {
        value = value * 10 + <u32>(load<u8>(pointer + lane) - 0x30);
      }
      sum += value;
      pointer += 8;
    }
  }
  return sum;
}


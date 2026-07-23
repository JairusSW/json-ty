import {
  deserializeFloatScalar,
  deserializeFloat_SWAR,
} from "../deserialize/swar/float";

const RESULT: usize = memory.data<f64>([0]);

export function parse(start: usize, end: usize): usize {
  return deserializeFloat_SWAR(start, end, RESULT);
}

export function result(): f64 {
  return load<f64>(RESULT);
}

export function benchSwar(
  start: usize,
  end: usize,
  iterations: u32,
): f64 {
  let checksum = 0.0;
  for (let index: u32 = 0; index < iterations; index++) {
    deserializeFloat_SWAR(start, end, RESULT);
    checksum += load<f64>(RESULT);
  }
  return checksum;
}

export function benchScalar(
  start: usize,
  end: usize,
  iterations: u32,
): f64 {
  let checksum = 0.0;
  for (let index: u32 = 0; index < iterations; index++) {
    deserializeFloatScalar(start, end, RESULT);
    checksum += load<f64>(RESULT);
  }
  return checksum;
}


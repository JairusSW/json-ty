// Checked UTF-8 SWAR float parser.
//
// This retains json-as's scalar short integer prefix, four-digit fractional
// fold, exact u64 mantissa, Clinger fast range, Eisel-Lemire conversion, and
// wide scientific fallback. Inputs with more than 19 significant digits use
// json-ty's host byte-span fallback for bit-identical rounding.

import { parse4Digits } from "../digits";
import { eiselLemire22 } from "../../eisel-lemire";

@external("env", "parseNumberSlow")
declare function parseNumberSlow(pointer: u32, length: u32): f64;

const POW10: usize = memory.data<f64>([
  1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11,
  1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
]);

@inline
function isDigit(value: u8): bool {
  return <u32>(value - 0x30) <= 9;
}

@inline
function power10(exponent: i32): f64 {
  return load<f64>(POW10 + (<usize>exponent << 3));
}

/**
 * Parse one JSON number, store f64 output, and return the first byte after the
 * token. Zero is the syntax/fallback-contract failure sentinel.
 */
function deserializeFloat(
  start: usize,
  end: usize,
  destination: usize,
  packed: bool,
): usize {
  const original = start;
  let pointer = start;
  let negative = false;
  if (pointer < end && load<u8>(pointer) == 0x2d) {
    negative = true;
    pointer++;
  }
  if (pointer >= end) return 0;

  let mantissa: u64 = 0;
  let mantissaDigits: i32 = 0;
  let discardedDigits: i32 = 0;
  let significant = false;

  let value = load<u8>(pointer);
  if (value == 0x30) {
    pointer++;
    if (pointer < end && isDigit(load<u8>(pointer))) return 0;
  } else {
    if (value < 0x31 || value > 0x39) return 0;
    significant = true;
    mantissa = <u64>(value - 0x30);
    mantissaDigits = 1;
    pointer++;
    // json-as keeps typical 1-3 digit integer prefixes scalar. Long prefixes
    // remain scalar too because a delimiter usually defeats a packed probe.
    while (pointer < end && isDigit(load<u8>(pointer))) {
      const digit = <u64>(load<u8>(pointer) - 0x30);
      if (mantissaDigits < 19) {
        mantissa = mantissa * 10 + digit;
        mantissaDigits++;
      } else {
        discardedDigits++;
      }
      pointer++;
    }
  }

  // Integer-valued JSON numbers dominate typed object fields. Once their
  // delimiter is known, a Wasm u64-to-f64 conversion is already correctly
  // rounded and avoids all fractional/exponent bookkeeping and power-table
  // branches. Only values wider than the retained 19-digit mantissa need the
  // host fallback.
  if (
    pointer >= end ||
    (load<u8>(pointer) != 0x2e &&
      load<u8>(pointer) != 0x65 &&
      load<u8>(pointer) != 0x45)
  ) {
    let parsed: f64;
    if (discardedDigits != 0) {
      const unsignedStart = negative ? original + 1 : original;
      parsed = parseNumberSlow(
        <u32>unsignedStart,
        <u32>(pointer - unsignedStart),
      );
      if (parsed != parsed) return 0;
    } else {
      parsed = <f64>mantissa;
    }
    if (negative) parsed = -parsed;
    store<f64>(destination, parsed);
    return pointer;
  }

  let fractionalDigits: i32 = 0;
  if (pointer < end && load<u8>(pointer) == 0x2e) {
    pointer++;
    if (pointer >= end || !isDigit(load<u8>(pointer))) return 0;

    while (pointer < end && isDigit(load<u8>(pointer))) {
      if (
        packed &&
        significant &&
        mantissaDigits <= 15 &&
        end - pointer >= 4
      ) {
        const packed = parse4Digits(load<u32>(pointer));
        if (packed != U32.MAX_VALUE) {
          mantissa = mantissa * 10_000 + packed;
          mantissaDigits += 4;
          fractionalDigits += 4;
          pointer += 4;
          continue;
        }
      }

      const digit = <u64>(load<u8>(pointer) - 0x30);
      significant = significant || digit != 0;
      if (significant) {
        if (mantissaDigits < 19) {
          mantissa = mantissa * 10 + digit;
          mantissaDigits++;
        } else {
          discardedDigits++;
        }
      }
      fractionalDigits++;
      pointer++;
    }
  }

  let explicitExponent: i32 = 0;
  if (pointer < end) {
    value = load<u8>(pointer);
    if (value == 0x65 || value == 0x45) {
      pointer++;
      let exponentNegative = false;
      if (pointer < end) {
        value = load<u8>(pointer);
        if (value == 0x2b) {
          pointer++;
        } else if (value == 0x2d) {
          exponentNegative = true;
          pointer++;
        }
      }
      if (pointer >= end || !isDigit(load<u8>(pointer))) return 0;
      while (pointer < end && isDigit(load<u8>(pointer))) {
        if (explicitExponent < 10_000) {
          explicitExponent =
            explicitExponent * 10 + <i32>(load<u8>(pointer) - 0x30);
        }
        pointer++;
      }
      if (exponentNegative) explicitExponent = -explicitExponent;
    }
  }

  const exponent = explicitExponent - fractionalDigits + discardedDigits;
  let parsed: f64;
  if (discardedDigits != 0 || exponent < -22 || exponent > 22) {
    const unsignedStart = negative ? original + 1 : original;
    parsed = parseNumberSlow(
      <u32>unsignedStart,
      <u32>(pointer - unsignedStart),
    );
    if (parsed != parsed) return 0;
  } else if (
    mantissa <= 9_007_199_254_740_992 &&
    exponent >= -22 &&
    exponent <= 22
  ) {
    parsed = <f64>mantissa;
    if (exponent > 0) parsed *= power10(exponent);
    else if (exponent < 0) parsed /= power10(-exponent);
  } else {
    parsed = eiselLemire22(mantissa, exponent);
  }

  if (negative) parsed = -parsed;
  store<f64>(destination, parsed);
  return pointer;
}

@inline
export function deserializeFloat_SWAR(
  start: usize,
  end: usize,
  destination: usize,
): usize {
  return deserializeFloat(start, end, destination, true);
}

@inline
export function deserializeFloatScalar(
  start: usize,
  end: usize,
  destination: usize,
): usize {
  return deserializeFloat(start, end, destination, false);
}

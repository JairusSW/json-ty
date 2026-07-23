const BACK_SLASH: u8 = 0x5c;
const BRACE_LEFT: u8 = 0x7b;
const BRACE_RIGHT: u8 = 0x7d;
const BRACKET_LEFT: u8 = 0x5b;
const BRACKET_RIGHT: u8 = 0x5d;
const COLON: u8 = 0x3a;
const COMMA: u8 = 0x2c;
const QUOTE: u8 = 0x22;

@inline
function isSpace(value: u8): bool {
  return value == 0x20 || value == 0x09 || value == 0x0a || value == 0x0d;
}

// Direct UTF-8 byte-lane adaptation of json-as's SWAR value-end scanner.
// Masks remain filters: every candidate lane is confirmed with a real byte
// load before it can affect quote state or nesting depth.

const ONES: u64 = 0x0101_0101_0101_0101;
const HI: u64 = 0x8080_8080_8080_8080;

@inline
function eqPart(block: u64, splat: u64): u64 {
  const value = block ^ splat;
  return (value - ONES) & ~value;
}

const S_QUOTE: u64 = 0x2222_2222_2222_2222;
const S_BACK_SLASH: u64 = 0x5c5c_5c5c_5c5c_5c5c;
const S_BRACKET_LEFT: u64 = 0x5b5b_5b5b_5b5b_5b5b;
const S_BRACKET_RIGHT: u64 = 0x5d5d_5d5d_5d5d_5d5d;
// Clear ASCII bit 5 in every byte, folding braces onto brackets.
const FOLD: u64 = 0xdfdf_dfdf_dfdf_dfdf;

@inline
function quoteOrBackslashMask(block: u64): u64 {
  return (eqPart(block, S_QUOTE) | eqPart(block, S_BACK_SLASH)) & HI;
}

@inline
function structuralOrQuoteMask(block: u64): u64 {
  const folded = block & FOLD;
  return (
    (eqPart(folded, S_BRACKET_LEFT) |
      eqPart(folded, S_BRACKET_RIGHT) |
      eqPart(block, S_QUOTE)) &
    HI
  );
}

function scanQuotedValueEnd_SWAR(start: usize, end: usize): usize {
  let pointer = start + 1;
  const end8 = end >= 8 ? end - 8 : 0;

  // Keep json-as's full-word skip and scalar-confirmation ordering. On the
  // first real backslash, restart at the word boundary and let the scalar tail
  // consume escape pairs exactly.
  while (pointer <= end8) {
    let mask = quoteOrBackslashMask(load<u64>(pointer));
    if (mask == 0) {
      pointer += 8;
      continue;
    }
    do {
      const candidate = pointer + <usize>(ctz(mask) >> 3);
      mask &= mask - 1;
      const code = load<u8>(candidate);
      if (code == QUOTE) return candidate + 1;
      if (code == BACK_SLASH) break;
    } while (mask != 0);
    break;
  }

  while (pointer < end) {
    const code = load<u8>(pointer);
    if (code == BACK_SLASH) {
      pointer += 2;
      continue;
    }
    if (code == QUOTE) return pointer + 1;
    pointer++;
  }
  return 0;
}

function scanCompositeValueEnd_SWAR(start: usize, end: usize): usize {
  let depth: i32 = 1;
  let pointer = start + 1;
  const end8 = end >= 8 ? end - 8 : 0;

  while (pointer < end) {
    const code = load<u8>(pointer);
    if (code == QUOTE) {
      pointer = scanQuotedValueEnd_SWAR(pointer, end);
      if (pointer == 0) return 0;
      continue;
    }

    const folded = code & 0xdf;
    if (folded == BRACKET_LEFT) {
      depth++;
      pointer++;
      continue;
    }
    if (folded == BRACKET_RIGHT) {
      if (--depth == 0) return pointer + 1;
      pointer++;
      continue;
    }

    pointer++;
    if (code == COMMA || code == COLON) continue;

    while (pointer <= end8) {
      const mask = structuralOrQuoteMask(load<u64>(pointer));
      if (mask == 0) {
        pointer += 8;
        continue;
      }
      const candidate = pointer + <usize>(ctz(mask) >> 3);
      const next = load<u8>(candidate);
      const nextFolded = next & 0xdf;
      if (
        next == QUOTE ||
        nextFolded == BRACKET_LEFT ||
        nextFolded == BRACKET_RIGHT
      ) {
        pointer = candidate;
        break;
      }
      pointer = candidate + 1;
    }
  }
  return 0;
}

function scanScalarValueEnd_SWAR(start: usize, end: usize): usize {
  while (start < end) {
    const code = load<u8>(start);
    if (
      code == COMMA ||
      code == BRACKET_RIGHT ||
      code == BRACE_RIGHT ||
      isSpace(code)
    ) {
      return start;
    }
    start++;
  }
  return start;
}

/**
 * Return the byte pointer immediately after one JSON value, or zero for empty
 * input and unterminated quoted/composite values.
 *
 * This scanner locates a boundary; like json-as's original, it does not
 * validate the complete scalar grammar. Every u64 load is guarded by
 * `pointer + 8 <= end`.
 */
export function scanValueEnd_SWAR(start: usize, end: usize): usize {
  if (start >= end) return 0;
  const first = load<u8>(start);
  if (first == QUOTE) return scanQuotedValueEnd_SWAR(start, end);
  if (first == BRACE_LEFT || first == BRACKET_LEFT) {
    return scanCompositeValueEnd_SWAR(start, end);
  }
  return scanScalarValueEnd_SWAR(start, end);
}


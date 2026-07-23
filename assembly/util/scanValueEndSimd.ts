const BACK_SLASH: u8 = 0x5c;
const BRACE_LEFT: u8 = 0x7b;
const BRACE_RIGHT: u8 = 0x7d;
const BRACKET_LEFT: u8 = 0x5b;
const BRACKET_RIGHT: u8 = 0x5d;
const COMMA: u8 = 0x2c;
const QUOTE: u8 = 0x22;

@inline
function isSpace(value: u8): bool {
  return value == 0x20 || value == 0x09 || value == 0x0a || value == 0x0d;
}

@inline
function quoteOrBackslashMask(block: v128): i32 {
  return i8x16.bitmask(v128.or(
    i8x16.eq(block, i8x16.splat(QUOTE)),
    i8x16.eq(block, i8x16.splat(BACK_SLASH)),
  ));
}

@inline
function structuralOrQuoteMask(block: v128): i32 {
  const folded = v128.and(block, i8x16.splat(<i8>0xdf));
  return i8x16.bitmask(v128.or(
    v128.or(
      i8x16.eq(folded, i8x16.splat(BRACKET_LEFT)),
      i8x16.eq(folded, i8x16.splat(BRACKET_RIGHT)),
    ),
    i8x16.eq(block, i8x16.splat(QUOTE)),
  ));
}

function scanQuotedValueEnd_SIMD(start: usize, end: usize): usize {
  let pointer = start + 1;
  const end16 = end >= 16 ? end - 16 : 0;
  while (pointer <= end16) {
    const mask = quoteOrBackslashMask(v128.load(pointer));
    if (mask == 0) {
      pointer += 16;
      continue;
    }
    const candidate = pointer + <usize>ctz(mask);
    if (load<u8>(candidate) == QUOTE) return candidate + 1;
    if (candidate + 1 >= end) return 0;
    pointer = candidate + 2;
  }
  while (pointer < end) {
    const code = load<u8>(pointer);
    if (code == QUOTE) return pointer + 1;
    if (code == BACK_SLASH) {
      if (pointer + 1 >= end) return 0;
      pointer += 2;
    } else pointer++;
  }
  return 0;
}

function scanCompositeValueEnd_SIMD(start: usize, end: usize): usize {
  let depth: i32 = 1;
  let pointer = start + 1;
  const end16 = end >= 16 ? end - 16 : 0;
  let inString = false;
  while (pointer <= end16) {
    let mask = structuralOrQuoteMask(v128.load(pointer));
    while (mask != 0) {
      const event = pointer + <usize>ctz(mask);
      mask &= mask - 1;
      const code = load<u8>(event);
      if (code == QUOTE) {
        if (!inString) inString = true;
        else {
          let slash = event;
          let escaped = false;
          while (slash > start && load<u8>(slash - 1) == BACK_SLASH) {
            escaped = !escaped;
            slash--;
          }
          if (!escaped) inString = false;
        }
      } else if (!inString) {
        const folded = code & 0xdf;
        if (folded == BRACKET_LEFT) depth++;
        else if (folded == BRACKET_RIGHT && --depth == 0) return event + 1;
      }
    }
    pointer += 16;
  }
  while (pointer < end) {
    const code = load<u8>(pointer);
    if (code == QUOTE) {
      if (!inString) inString = true;
      else {
        let slash = pointer;
        let escaped = false;
        while (slash > start && load<u8>(slash - 1) == BACK_SLASH) {
          escaped = !escaped;
          slash--;
        }
        if (!escaped) inString = false;
      }
    } else if (!inString) {
      const folded = code & 0xdf;
      if (folded == BRACKET_LEFT) depth++;
      else if (folded == BRACKET_RIGHT && --depth == 0) return pointer + 1;
    }
    pointer++;
  }
  return 0;
}

function scanScalarValueEnd_SIMD(start: usize, end: usize): usize {
  const end16 = end >= 16 ? end - 16 : 0;
  while (start <= end16) {
    const block = v128.load(start);
    const structural = v128.or(
      v128.or(i8x16.eq(block, i8x16.splat(COMMA)), i8x16.eq(block, i8x16.splat(BRACE_RIGHT))),
      i8x16.eq(block, i8x16.splat(BRACKET_RIGHT)),
    );
    const whitespace = v128.or(
      i8x16.eq(block, i8x16.splat(0x20)),
      i8x16.le_u(i8x16.sub(block, i8x16.splat(0x09)), i8x16.splat(0x04)),
    );
    const mask = i8x16.bitmask(v128.or(structural, whitespace));
    if (mask != 0) return start + <usize>ctz(mask);
    start += 16;
  }
  while (start < end) {
    const code = load<u8>(start);
    if (code == COMMA || code == BRACKET_RIGHT || code == BRACE_RIGHT || isSpace(code)) return start;
    start++;
  }
  return start;
}

/** Boundary scan for caller-validated canonical UTF-8 JSON. */
export function scanValueEnd_SIMD(start: usize, end: usize): usize {
  if (start >= end) return 0;
  const first = load<u8>(start);
  if (first == QUOTE) return scanQuotedValueEnd_SIMD(start, end);
  if (first == BRACE_LEFT || first == BRACKET_LEFT) return scanCompositeValueEnd_SIMD(start, end);
  return scanScalarValueEnd_SIMD(start, end);
}

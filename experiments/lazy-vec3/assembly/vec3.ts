// MVP of the on-demand in-place parse from ../PROTOCOL.md, for one schema:
//   Vec3 = { "x": <number>, "y": <number>, "z": <number> }
//
// JS writes the JSON (UTF-8) into SRC, calls scan(len), then reads the slot
// tape and materializes each number lazily. The JSON buffer stays in linear
// memory; we only ever hand back a fixed 3-slot tape of byte spans.
//
// Built with --runtime stub (bump allocator). The scan allocates nothing.

export const CAP: i32 = 1 << 20; // 1 MiB source buffer
const SRC = new StaticArray<u8>(CAP);
// 16-byte header + 3 × u64 slots
const TAPE = new StaticArray<u8>(16 + 3 * 8);

// Slot word layout (see PROTOCOL.md). Tags are JSON.Types.
const VAL_QNAN: u64 = 0x7ffc000000000000;
const TAG_SHIFT: u64 = 45;
const TAG_NULL: u64 = 0;
const TAG_RAW: u64 = 1;

// JSON byte constants
const LBRACE: u8 = 0x7b; // {
const RBRACE: u8 = 0x7d; // }
const QUOTE: u8 = 0x22; //  "
const COLON: u8 = 0x3a; //  :
const COMMA: u8 = 0x2c; //  ,

export function srcPtr(): usize { return changetype<usize>(SRC); }
export function tapePtr(): usize { return changetype<usize>(TAPE); }

// @ts-ignore: inline decorator
@inline function isWs(b: u8): bool {
  return b == 0x20 || b == 0x09 || b == 0x0a || b == 0x0d;
}

// @ts-ignore: inline decorator
@inline function compactSlot(tag: u64, offset: i32, length: i32): u64 {
  const payload = (<u64>length << 22) | <u64>offset;
  return VAL_QNAN | (tag << TAG_SHIFT) | payload;
}

// @ts-ignore: inline decorator
@inline function fail(tape: usize, at: i32): i32 {
  store<u8>(tape + 1, 1); // errorCode = 1 (unexpected token)
  store<u32>(tape + 8, <u32>at); // faultOff
  return 1;
}

/** Scan `len` bytes of JSON in SRC into the slot tape. Returns errorCode. */
export function scan(len: i32): i32 {
  const base = changetype<usize>(SRC);
  const tape = changetype<usize>(TAPE);
  const slots = tape + 16;

  // header
  store<u8>(tape, 1); // version
  store<u8>(tape + 1, 0); // errorCode (ok)
  store<u8>(tape + 2, 14); // rootType = Object
  store<u8>(tape + 3, 0); // flags
  store<u32>(tape + 4, 3); // count
  store<u32>(tape + 8, 0); // faultOff
  store<u32>(tape + 12, <u32>slots); // tapePtr -> slots
  // default every slot to Null (absent)
  store<u64>(slots, VAL_QNAN | (TAG_NULL << TAG_SHIFT));
  store<u64>(slots + 8, VAL_QNAN | (TAG_NULL << TAG_SHIFT));
  store<u64>(slots + 16, VAL_QNAN | (TAG_NULL << TAG_SHIFT));

  let i = 0;
  while (i < len && isWs(load<u8>(base + i))) i++;
  if (i >= len || load<u8>(base + i) != LBRACE) return fail(tape, i);
  i++;

  while (i < len) {
    while (i < len && isWs(load<u8>(base + i))) i++;
    if (i >= len) return fail(tape, i);
    if (load<u8>(base + i) == RBRACE) break;
    if (load<u8>(base + i) != QUOTE) return fail(tape, i);
    i++;

    // key (MVP: assume no escapes in keys)
    const keyStart = i;
    while (i < len && load<u8>(base + i) != QUOTE) i++;
    const keyLen = i - keyStart;
    if (i >= len) return fail(tape, i);
    i++; // past closing quote

    // map key -> schema slot
    let slot = -1;
    if (keyLen == 1) {
      const k = load<u8>(base + keyStart);
      if (k == 0x78) slot = 0; // x
      else if (k == 0x79) slot = 1; // y
      else if (k == 0x7a) slot = 2; // z
    }

    while (i < len && isWs(load<u8>(base + i))) i++;
    if (i >= len || load<u8>(base + i) != COLON) return fail(tape, i);
    i++;
    while (i < len && isWs(load<u8>(base + i))) i++;

    // value span (MVP: number/literal token — ends at , } or whitespace)
    const valStart = i;
    while (i < len) {
      const b = load<u8>(base + i);
      if (b == COMMA || b == RBRACE || isWs(b)) break;
      i++;
    }
    const valLen = i - valStart;
    if (valLen == 0) return fail(tape, i);
    if (slot >= 0) {
      store<u64>(slots + (slot << 3), compactSlot(TAG_RAW, valStart, valLen));
    }

    while (i < len && isWs(load<u8>(base + i))) i++;
    if (i < len && load<u8>(base + i) == COMMA) { i++; continue; }
    if (i < len && load<u8>(base + i) == RBRACE) break;
  }
  return 0;
}

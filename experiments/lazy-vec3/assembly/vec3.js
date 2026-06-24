// MVP of the on-demand in-place parse from ../PROTOCOL.md, for one schema:
//   Vec3 = { "x": <number>, "y": <number>, "z": <number> }
//
// JS writes the JSON (UTF-8) into SRC, calls scan(len), then reads the slot
// tape and materializes each number lazily. The JSON buffer stays in linear
// memory; we only ever hand back a fixed 3-slot tape of byte spans.
//
// Built with --runtime stub (bump allocator). The scan allocates nothing.
export const CAP = 1 << 20; // 1 MiB source buffer
const SRC = new StaticArray(CAP);
// 16-byte header + 3 × u64 slots
const TAPE = new StaticArray(16 + 3 * 8);
// Slot word layout (see PROTOCOL.md). Tags are JSON.Types.
const VAL_QNAN = 0x7ffc000000000000;
const TAG_SHIFT = 45;
const TAG_NULL = 0;
const TAG_RAW = 1;
// JSON byte constants
const LBRACE = 0x7b; // {
const RBRACE = 0x7d; // }
const QUOTE = 0x22; //  "
const COLON = 0x3a; //  :
const COMMA = 0x2c; //  ,
export function srcPtr() { return changetype(SRC); }
export function tapePtr() { return changetype(TAPE); }
// @ts-ignore: inline decorator
function isWs(b) {
    return b == 0x20 || b == 0x09 || b == 0x0a || b == 0x0d;
}
// @ts-ignore: inline decorator
function compactSlot(tag, offset, length) {
    const payload = (length << 22) | offset;
    return VAL_QNAN | (tag << TAG_SHIFT) | payload;
}
// @ts-ignore: inline decorator
function fail(tape, at) {
    store(tape + 1, 1); // errorCode = 1 (unexpected token)
    store(tape + 8, at); // faultOff
    return 1;
}
/** Scan `len` bytes of JSON in SRC into the slot tape. Returns errorCode. */
export function scan(len) {
    const base = changetype(SRC);
    const tape = changetype(TAPE);
    const slots = tape + 16;
    // header
    store(tape, 1); // version
    store(tape + 1, 0); // errorCode (ok)
    store(tape + 2, 14); // rootType = Object
    store(tape + 3, 0); // flags
    store(tape + 4, 3); // count
    store(tape + 8, 0); // faultOff
    store(tape + 12, slots); // tapePtr -> slots
    // default every slot to Null (absent)
    store(slots, VAL_QNAN | (TAG_NULL << TAG_SHIFT));
    store(slots + 8, VAL_QNAN | (TAG_NULL << TAG_SHIFT));
    store(slots + 16, VAL_QNAN | (TAG_NULL << TAG_SHIFT));
    let i = 0;
    while (i < len && isWs(load(base + i)))
        i++;
    if (i >= len || load(base + i) != LBRACE)
        return fail(tape, i);
    i++;
    while (i < len) {
        while (i < len && isWs(load(base + i)))
            i++;
        if (i >= len)
            return fail(tape, i);
        if (load(base + i) == RBRACE)
            break;
        if (load(base + i) != QUOTE)
            return fail(tape, i);
        i++;
        // key (MVP: assume no escapes in keys)
        const keyStart = i;
        while (i < len && load(base + i) != QUOTE)
            i++;
        const keyLen = i - keyStart;
        if (i >= len)
            return fail(tape, i);
        i++; // past closing quote
        // map key -> schema slot
        let slot = -1;
        if (keyLen == 1) {
            const k = load(base + keyStart);
            if (k == 0x78)
                slot = 0; // x
            else if (k == 0x79)
                slot = 1; // y
            else if (k == 0x7a)
                slot = 2; // z
        }
        while (i < len && isWs(load(base + i)))
            i++;
        if (i >= len || load(base + i) != COLON)
            return fail(tape, i);
        i++;
        while (i < len && isWs(load(base + i)))
            i++;
        // value span (MVP: number/literal token — ends at , } or whitespace)
        const valStart = i;
        while (i < len) {
            const b = load(base + i);
            if (b == COMMA || b == RBRACE || isWs(b))
                break;
            i++;
        }
        const valLen = i - valStart;
        if (valLen == 0)
            return fail(tape, i);
        if (slot >= 0) {
            store(slots + (slot << 3), compactSlot(TAG_RAW, valStart, valLen));
        }
        while (i < len && isWs(load(base + i)))
            i++;
        if (i < len && load(base + i) == COMMA) {
            i++;
            continue;
        }
        if (i < len && load(base + i) == RBRACE)
            break;
    }
    return 0;
}

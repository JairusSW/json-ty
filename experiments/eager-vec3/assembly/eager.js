// Eager primitive parse: non-string primitives are parsed in AS and the actual
// value is handed back to JS (no lazy span, no JS-side parseFloat). Vec3 is all
// numbers, so AS parses x/y/z to f64 during the scan and writes them to a slot
// array JS reads directly. (Strings would stay lazy spans — not here.)
//
// Built --runtime stub. parseF64 uses the Clinger fast path (exact when the
// mantissa fits 2^53 and |exp| <= 22 — the common case incl. all our inputs).
export const CAP = 1 << 20;
const SRC = new StaticArray(CAP);
const SLOTS = new StaticArray(3); // x, y, z (NaN = absent)
export function srcPtr() { return changetype(SRC); }
export function slotsPtr() { return changetype(SLOTS); }
// 10^0 .. 10^22 — all exactly representable as f64.
const POW10 = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11,
    1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
];
// @ts-ignore: inline
function isDigit(c) { return c >= 0x30 && c <= 0x39; }
// @ts-ignore: inline
function isWs(b) { return b == 0x20 || b == 0x09 || b == 0x0a || b == 0x0d; }
/** Parse the JSON number in SRC[p..end) to f64. */
function parseF64(p, end) {
    let i = p;
    while (i < end && isWs(load(i)))
        i++;
    let neg = false;
    if (i < end && load(i) == 0x2d) {
        neg = true;
        i++;
    } // '-'
    let mant = 0;
    let fracDigits = 0;
    while (i < end && isDigit(load(i))) {
        mant = mant * 10 + (load(i) - 0x30);
        i++;
    }
    if (i < end && load(i) == 0x2e) { // '.'
        i++;
        while (i < end && isDigit(load(i))) {
            mant = mant * 10 + (load(i) - 0x30);
            fracDigits++;
            i++;
        }
    }
    let exp = 0, expNeg = false;
    if (i < end) {
        const c = load(i);
        if (c == 0x65 || c == 0x45) { // e / E
            i++;
            if (i < end) {
                const s = load(i);
                if (s == 0x2b)
                    i++;
                else if (s == 0x2d) {
                    expNeg = true;
                    i++;
                }
            }
            while (i < end && isDigit(load(i))) {
                exp = exp * 10 + (load(i) - 0x30);
                i++;
            }
        }
    }
    if (expNeg)
        exp = -exp;
    const finalExp = exp - fracDigits;
    let result;
    if (mant <= 9007199254740992 && finalExp >= -22 && finalExp <= 22) {
        const m = mant;
        result = finalExp >= 0 ? m * POW10[finalExp] : m / POW10[-finalExp];
    }
    else {
        result = mant * (10.0 ** finalExp); // rare fallback (may be ±1 ulp)
    }
    return neg ? -result : result;
}
const NaN64 = NaN;
/** Eager-parse a Vec3 object in SRC[0..len). Returns errorCode. */
export function parseVec3(len) {
    const base = changetype(SRC);
    const slots = changetype(SLOTS);
    store(slots, NaN64);
    store(slots + 8, NaN64);
    store(slots + 16, NaN64);
    let i = 0;
    while (i < len && isWs(load(base + i)))
        i++;
    if (i >= len || load(base + i) != 0x7b)
        return 1; // '{'
    i++;
    while (i < len) {
        while (i < len && isWs(load(base + i)))
            i++;
        if (i < len && load(base + i) == 0x7d)
            break; // '}'
        if (i >= len || load(base + i) != 0x22)
            return 1; // '"'
        i++;
        const keyByte = load(base + i);
        while (i < len && load(base + i) != 0x22)
            i++;
        i++; // past closing quote
        let slot = -1;
        if (keyByte == 0x78)
            slot = 0;
        else if (keyByte == 0x79)
            slot = 1;
        else if (keyByte == 0x7a)
            slot = 2;
        while (i < len && isWs(load(base + i)))
            i++;
        if (i >= len || load(base + i) != 0x3a)
            return 1; // ':'
        i++;
        const valStart = i;
        while (i < len) {
            const b = load(base + i);
            if (b == 0x2c || b == 0x7d)
                break;
            i++;
        }
        if (slot >= 0)
            store(slots + (slot << 3), parseF64(base + valStart, base + i));
        while (i < len && isWs(load(base + i)))
            i++;
        if (i < len && load(base + i) == 0x2c) {
            i++;
            continue;
        }
        if (i < len && load(base + i) == 0x7d)
            break;
    }
    return 0;
}

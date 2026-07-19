// JS <-> WASM string-boundary throughput probe.
//
// Built with `--runtime stub` (bump allocator, no GC) and utf-as for the
// UTF-8 <-> UTF-16 transcode. The point is to measure the *ceiling* on any
// "serialize in WASM" design: every byte of string has to cross the boundary
// and (usually) be transcoded between JS's UTF-16 and JSON's UTF-8.
// asc's bare-name node_modules resolution misbehaves for this package here, so
// reach the installed utf-as source directly.
import { UTF8 } from "../../../node_modules/utf-as/assembly/index";
// Shared scratch region JS writes into / reads out of. One stable pointer for
// the whole run (stub runtime never moves or frees it).
export const CAP = 64 << 20; // 64 MiB
const BUF = new StaticArray(CAP);
// The AS-side string we hold between an ingest and a later emit.
let stored = "";
export function bufPtr() {
    return changetype(BUF);
}
// --- receive direction (JS -> WASM) ---------------------------------------
// JS has written `len` UTF-8 bytes at bufPtr(). Decode them into an AS string
// (allocates UTF-16) and keep it. Returns the UTF-16 code-unit count so the
// call can't be optimized away.
export function ingestUtf8(len) {
    stored = UTF8.decodeUnsafe(bufPtr(), len);
    return stored.length;
}
// Same boundary copy, but validate-only: no UTF-16 allocation. Isolates the
// cost of the SIMD scan from the cost of materializing a string.
export function validateUtf8(len) {
    return UTF8.validateUnsafe(bufPtr(), len);
}
// --- send direction (WASM -> JS) ------------------------------------------
// Encode the held string to UTF-8 at bufPtr(). Returns the byte count for JS
// to slice out and decode.
export function emitUtf8() {
    return UTF8.encodeUnsafe(changetype(stored), stored.length, bufPtr());
}

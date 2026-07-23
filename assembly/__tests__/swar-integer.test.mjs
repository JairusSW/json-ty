import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { instance } = await WebAssembly.instantiate(
  await readFile(new URL("../../build/swar-port/integer.wasm", import.meta.url)),
  { env: { abort() { throw new Error("unexpected abort"); } } },
);
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const encoder = new TextEncoder();
const U64_MAX = 0xffff_ffff_ffff_ffffn;

function put(source, offset) {
  const encoded = encoder.encode(source);
  bytes.set(encoded, offset);
  return [offset, offset + encoded.length];
}

function unsigned() {
  return BigInt.asUintN(64, api.unsignedResult());
}

for (let offset = 1; offset <= 15; offset++) {
  for (const [source, value] of [
    ["0", 0n],
    ["1", 1n],
    ["12345678", 12_345_678n],
    ["1234567890123456", 1_234_567_890_123_456n],
    ["18446744073709551615", U64_MAX],
  ]) {
    const [start, end] = put(source, offset);
    assert.equal(api.scanUnsigned(start, end, U64_MAX), end, source);
    assert.equal(unsigned(), value, source);
    assert.equal(api.parseExact(start, end, U64_MAX), 1, source);
    assert.equal(unsigned(), value, source);
  }
}

for (const source of ["", "+1", "-", "01", "00", "18446744073709551616"]) {
  const [start, end] = put(source, 37);
  assert.equal(api.scanUnsigned(start, end, U64_MAX), 0, source);
}

for (const [source, value] of [
  ["0", 0n],
  ["-0", 0n],
  ["42", 42n],
  ["-42", -42n],
  ["9223372036854775807", 9_223_372_036_854_775_807n],
  ["-9223372036854775808", -9_223_372_036_854_775_808n],
]) {
  const [start, end] = put(source, 53);
  assert.equal(api.scanSigned(start, end), end, source);
  assert.equal(api.signedResult(), value, source);
}

for (const source of ["+", "-", "01", "-01", "9223372036854775808", "-9223372036854775809"]) {
  const [start, end] = put(source, 71);
  assert.equal(api.scanSigned(start, end), 0, source);
}

let [start, end] = put("12345,tail", 91);
assert.equal(api.scanUnsigned(start, end, U64_MAX), start + 5);
assert.equal(unsigned(), 12_345n);
[start, end] = put("-987 whitespace", 91);
assert.equal(api.scanSigned(start, end), start + 4);
assert.equal(api.signedResult(), -987n);

[start, end] = put("255", 111);
assert.equal(api.scanUnsigned(start, end, 255n), end);
[start, end] = put("256", 111);
assert.equal(api.scanUnsigned(start, end, 255n), 0);

let state = 0x9e37_79b9;
for (let index = 0; index < 2000; index++) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  const high = BigInt(state);
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  const value = ((high << 32n) | BigInt(state)) & 0x7fff_ffff_ffff_ffffn;
  const source = value.toString();
  [start, end] = put(source, 137);
  assert.equal(api.scanUnsigned(start, end, U64_MAX), end);
  assert.equal(unsigned(), value);
}

for (let length = 1; length <= 20; length++) {
  const source = "9".repeat(Math.min(length, 19));
  const encoded = encoder.encode(source);
  const pageEnd = bytes.length;
  const pageStart = pageEnd - encoded.length;
  bytes.set(encoded, pageStart);
  assert.equal(api.scanUnsigned(pageStart, pageEnd, U64_MAX), pageEnd);
}

console.log("checked UTF-8 SWAR integers: all tests passed");


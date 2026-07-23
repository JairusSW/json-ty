import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const wasm = await WebAssembly.instantiate(
  await readFile(new URL("../../build/swar-port/primitives.wasm", import.meta.url)),
  {
    env: {
      abort() {
        throw new Error("unexpected AssemblyScript abort");
      },
    },
  },
);
const api = wasm.instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const encoder = new TextEncoder();

function packed(text) {
  let word = 0n;
  for (let i = 0; i < text.length; i++) {
    word |= BigInt(text.charCodeAt(i)) << BigInt(i * 8);
  }
  return word;
}

for (let offset = 1; offset <= 8; offset++) {
  for (let length = 0; length <= 15; length++) {
    const input = Uint8Array.from(
      { length },
      (_, index) => (index * 29 + length + offset) & 0xff,
    );
    bytes.fill(0xa5, offset, offset + 24);
    bytes.set(input, offset);
    const expected = input
      .subarray(0, 8)
      .reduce((word, value, lane) => word | (BigInt(value) << BigInt(lane * 8)), 0n);
    assert.equal(
      BigInt.asUintN(64, api.bounded(offset, offset + length)),
      expected,
    );
  }
}

assert.equal(api.decodeHex(Number(packed("1234"))), 0x1234);
assert.equal(api.decodeHex(Number(packed("aBcD"))), 0xabcd);
assert.equal(api.encodeHex(0x1234), Number(packed("1234")));
assert.equal(api.encodeHex(0xabcd), Number(packed("abcd")));

assert.equal(api.parse8(packed("12345678")), 12_345_678);
assert.equal(api.parse8(packed("00000000")), 0);
assert.equal(api.parse8(packed("1234x678")) >>> 0, 0xffff_ffff);
assert.equal(api.nondigits(packed("12345678")), 0n);
assert.notEqual(api.nondigits(packed("1234x678")), 0n);

for (let offset = 1; offset <= 8; offset++) {
  const value = encoder.encode("1234567890123456");
  bytes.set(value, offset);
  assert.equal(api.parse16(offset, offset + 16), 1_234_567_890_123_456n);
  assert.equal(
    BigInt.asUintN(64, api.parse16(offset, offset + 15)),
    0xffff_ffff_ffff_ffffn,
  );
}

const quoteMask = api.equals(packed('a"bc"def'), 0x22);
assert.notEqual(quoteMask & (0x80n << 8n), 0n);
assert.notEqual(quoteMask & (0x80n << 32n), 0n);

console.log("UTF-8 SWAR primitives: all tests passed");


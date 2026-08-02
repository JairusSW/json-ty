import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { instance } = await WebAssembly.instantiate(await readFile(new URL("../../build/swar-port/simd-string.wasm", import.meta.url)), {
  env: {
    abort() {
      throw new Error("unexpected abort");
    },
  },
});
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const encoder = new TextEncoder();

function check(input, strictExpected, trustedExpected = strictExpected) {
  bytes.set(input, 17);
  const end = 17 + input.length;
  assert.equal(api.scan(17, end, false), strictExpected ? api.scanReference(17, end, false) : 0n);
  assert.equal(api.scanLookup4(17, end, false), strictExpected ? api.scanReference(17, end, false) : 0n);
  assert.equal(api.scan(17, end, true), trustedExpected ? api.scanReference(17, end, true) : 0n);
}

for (const value of ["", "plain", "0123456789abcdef".repeat(8), 'quote: " slash: \\', "héllø 世界 😃"]) {
  check(encoder.encode(JSON.stringify(value)), true);
}

for (const input of [encoder.encode('"bad \\x escape"'), encoder.encode('"bad \\u12x4 escape"'), encoder.encode('"unterminated'), Uint8Array.of(0x22, 0x1f, 0x22)]) check(input, false);

for (const payload of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0x80], [0xf4, 0x90, 0x80, 0x80]]) {
  check(Uint8Array.of(0x22, ...payload, 0x22), false, true);
}

const validScalars = [
  [0xc2, 0xa2],
  [0xe2, 0x82, 0xac],
  [0xf0, 0x9f, 0x98, 0x83],
];
const invalidScalars = [
  [0xc0, 0x80], [0xc1, 0xbf], [0xe0, 0x9f, 0x80], [0xed, 0xa0, 0x80],
  [0xf0, 0x8f, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80],
  [0x80], [0xe2, 0x82], [0xf0, 0x9f, 0x98],
];
for (let lane = 0; lane < 16; lane++) {
  for (const scalar of validScalars) check(Uint8Array.of(0x22, ...new Uint8Array(lane).fill(0x61), ...scalar, 0x22), true);
  for (const scalar of invalidScalars) check(Uint8Array.of(0x22, ...new Uint8Array(lane).fill(0x61), ...scalar, 0x22), false, true);
}

check(encoder.encode('"é\\n世界😃\\tend"'), true);

console.log("strict/trusted UTF-8 SIMD strings: all tests passed");

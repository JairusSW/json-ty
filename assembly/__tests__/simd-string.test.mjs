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
  assert.equal(api.scan(17, end, true), trustedExpected ? api.scanReference(17, end, true) : 0n);
}

for (const value of ["", "plain", "0123456789abcdef".repeat(8), 'quote: " slash: \\', "héllø 世界 😃"]) {
  check(encoder.encode(JSON.stringify(value)), true);
}

for (const input of [encoder.encode('"bad \\x escape"'), encoder.encode('"bad \\u12x4 escape"'), encoder.encode('"unterminated'), Uint8Array.of(0x22, 0x1f, 0x22)]) check(input, false);

for (const payload of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0x80], [0xf4, 0x90, 0x80, 0x80]]) {
  check(Uint8Array.of(0x22, ...payload, 0x22), false, true);
}

console.log("strict/trusted UTF-8 SIMD strings: all tests passed");

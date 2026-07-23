import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { instance } = await WebAssembly.instantiate(
  await readFile(new URL("../../build/swar-port/string.wasm", import.meta.url)),
  { env: { abort() { throw new Error("unexpected abort"); } } },
);
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const encoder = new TextEncoder();

function write(input, offset) {
  bytes.set(input, offset);
  return [offset, offset + input.length];
}

function result(value) {
  const unsigned = BigInt.asUintN(64, value);
  return {
    next: Number(unsigned >> 32n),
    escaped: (unsigned & 1n) !== 0n,
  };
}

const valid = [
  '""',
  '"plain"',
  '"0123456789abcdef0123456789abcdef"',
  '"quote: \\" slash: \\\\ solidus: \\/"',
  '"unicode escape: \\uD83D\\uDE03"',
  '"héllø 世界 😃"',
];
for (let offset = 1; offset <= 15; offset++) {
  for (const source of valid) {
    const input = encoder.encode(source);
    const [start, end] = write(input, offset);
    const actual = api.scan(start, end, false);
    assert.equal(actual, api.scanReference(start, end, false));
    assert.deepEqual(result(actual), {
      next: end,
      escaped: source.includes("\\"),
    });
    assert.equal(api.scan(start, end, true), api.scanReference(start, end, true));
  }
}

const malformedPayloads = [
  [0xc0, 0xaf],
  [0xe0, 0x80, 0xaf],
  [0xed, 0xa0, 0x80],
  [0xe2, 0x82],
  [0x80],
  [0xf4, 0x90, 0x80, 0x80],
  [0xf5, 0x80, 0x80, 0x80],
];
for (const payload of malformedPayloads) {
  const input = Uint8Array.of(0x22, ...payload, 0x22);
  const [start, end] = write(input, 33);
  assert.equal(api.scan(start, end, false), 0n, payload);
  assert.notEqual(api.scan(start, end, true), 0n, payload);
}

for (const input of [
  Uint8Array.of(0x22, 0x1f, 0x22),
  encoder.encode('"bad \\x escape"'),
  encoder.encode('"bad \\u12x4 escape"'),
  encoder.encode('"trailing slash \\'),
  encoder.encode('"unterminated'),
]) {
  const [start, end] = write(input, 49);
  assert.equal(api.scan(start, end, false), 0n);
  assert.equal(api.scan(start, end, true), 0n);
}

for (let length = 1; length <= 15; length++) {
  const end = bytes.length;
  const start = end - length;
  bytes.fill(0x61, start, end);
  bytes[start] = 0x22;
  assert.equal(api.scan(start, end, false), 0n);
}

console.log("strict/trusted UTF-8 SWAR strings: all tests passed");


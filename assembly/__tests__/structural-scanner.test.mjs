import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { instance } = await WebAssembly.instantiate(
  await readFile(new URL("../../build/swar-port/structural-scanner.wasm", import.meta.url)),
  { env: { abort() { throw new Error("unexpected abort"); } } },
);
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const encoder = new TextEncoder();

const cases = [
  '""',
  '"plain ASCII string"',
  '"braces { [ ] } stay inside"',
  '"escaped quote: \\" and slash: \\\\ end"',
  "12345",
  "12345,tail",
  "true ",
  "null\n",
  "[]",
  "{}",
  "[1,2,3,4,5,6,7,8]",
  '[{"key":"value"},["}","]","\\\\"],true,null,-1.25e+3]',
  '{\n  "a": [1, 2, {"b": "x"} ],\n  "c": false\n}',
  "[".repeat(512) + "0" + "]".repeat(512),
];

for (let offset = 1; offset <= 15; offset++) {
  for (const input of cases) {
    const encoded = encoder.encode(input);
    bytes.set(encoded, offset);
    const expected = input === "12345,tail" ? offset + 5 :
      input === "true " ? offset + 4 :
      input === "null\n" ? offset + 4 :
      offset + encoded.length;
    assert.equal(
      api.scan(offset, offset + encoded.length),
      expected,
      `offset ${offset}, length ${encoded.length}: ${input}`,
    );
    assert.equal(
      api.scan(offset, offset + encoded.length),
      api.scanScalar(offset, offset + encoded.length),
      `oracle mismatch at offset ${offset}: ${input}`,
    );
  }
}

for (const input of ['"unterminated', '["unterminated"', "[1,2,3", '{"a":[1,2]']) {
  const encoded = encoder.encode(input);
  bytes.set(encoded, 33);
  bytes[33 + encoded.length] = 0x22;
  bytes[34 + encoded.length] = 0x7d;
  assert.equal(api.scan(33, 33 + encoded.length), 0, input);
}

// Exercise every short tail ending at the actual Wasm memory boundary. Any
// unguarded full-word read in the tail traps instead of observing padding.
for (let length = 1; length <= 15; length++) {
  const end = bytes.length;
  const start = end - length;
  bytes.fill(0x31, start, end);
  assert.equal(api.scan(start, end), end);
}

console.log("UTF-8 SWAR structural scanner: all tests passed");


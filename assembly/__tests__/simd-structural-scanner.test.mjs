import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { instance } = await WebAssembly.instantiate(
  await readFile(new URL("../../build/swar-port/simd-structural-scanner.wasm", import.meta.url)),
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
  '{"a":[1,2,{"b":"x"}],"c":false}',
  "[".repeat(512) + "0" + "]".repeat(512),
];

let seed = 0x9e3779b9;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
};
for (let index = 0; index < 500; index++) {
  cases.push(JSON.stringify({
    id: random(),
    text: `value-${random()}-\\-\"-${String.fromCodePoint(0x80 + (random() % 0x700))}`,
    values: Array.from({ length: random() % 12 }, () => random() % 1000),
    nested: { enabled: (random() & 1) !== 0, empty: null },
  }));
}

for (let offset = 1; offset <= 31; offset++) {
  for (const input of cases) {
    const encoded = encoder.encode(input);
    bytes.set(encoded, offset);
    const expected = input === "12345,tail" ? offset + 5
      : input === "true " ? offset + 4
        : input === "null\n" ? offset + 4
          : offset + encoded.length;
    assert.equal(api.scan(offset, offset + encoded.length), expected, `SIMD boundary mismatch at ${offset}: ${input}`);
    assert.equal(api.scan(offset, offset + encoded.length), api.oracle(offset, offset + encoded.length), `SWAR oracle mismatch at ${offset}: ${input}`);
  }
}

for (let length = 1; length <= 31; length++) {
  const end = bytes.length;
  const start = end - length;
  bytes.fill(0x31, start, end);
  assert.equal(api.scan(start, end), end);
}

console.log("UTF-8 SIMD structural scanner: all tests passed");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { instance } = await WebAssembly.instantiate(await readFile(new URL("../../build/swar-port/simd-serialize-string.wasm", import.meta.url)), {
  env: {
    abort() {
      throw new Error("unexpected abort");
    },
  },
});
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const source = 8192;
const output = 32768;

function invoke(kind, payload, capacity = 30000) {
  const input = encoder.encode(payload);
  bytes.set(input, source);
  api.begin(output, capacity);
  const ok = api[kind](source, input.length);
  const written = api.finish();
  return {
    ok,
    written,
    required: api.required(),
    text: decoder.decode(bytes.subarray(output, output + written)),
  };
}

for (const payload of ["", "plain 世界", "0123456789abcdef".repeat(16)]) {
  assert.equal(invoke("serializeClean", payload).text, JSON.stringify(payload));
}

for (const payload of ["line\\nfeed", "long clean run 0123456789abcdef0123456789abcdef\\tend", 'solidus\\/quote\\"', "\\u0000", "\\ud800", "\\ud83d\\ude03"]) {
  const expected = JSON.stringify(JSON.parse(`"${payload}"`));
  assert.equal(invoke("serializeEscaped", payload).text, expected, payload);
}

const exact = invoke("serializeEscaped", "long clean run 0123456789abcdef\\n");
const short = invoke("serializeEscaped", "long clean run 0123456789abcdef\\n", exact.written - 1);
assert.equal(short.ok, 0);
assert.equal(short.written, 0);
assert.equal(short.required, exact.written);

console.log("bounded UTF-8 SIMD retained-string serialization: all tests passed");

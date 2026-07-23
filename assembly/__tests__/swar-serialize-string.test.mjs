import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { instance } = await WebAssembly.instantiate(
  await readFile(new URL("../../build/swar-port/serialize-string.wasm", import.meta.url)),
  { env: { abort() { throw new Error("unexpected abort"); } } },
);
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sourceBase = 8192;
const output = 32768;

function invoke(kind, input, capacity = 30000, sourceOffset = sourceBase) {
  bytes.set(input, sourceOffset);
  bytes.fill(0xa5, output, output + capacity + 16);
  api.begin(output, capacity);
  const ok = api[kind](sourceOffset, input.length);
  const written = api.finish();
  return {
    ok,
    written,
    required: api.required(),
    text: decoder.decode(bytes.subarray(output, output + written)),
  };
}

for (let offset = 1; offset <= 15; offset++) {
  for (const value of [
    "",
    "plain ASCII",
    'quote " and slash \\',
    "\b\t\n\f\r",
    String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index)),
    "héllø 世界 😃",
  ]) {
    const expected = JSON.stringify(value);
    const input = encoder.encode(value);
    const result = invoke("serializeRaw", input, 30000, sourceBase + offset);
    assert.equal(result.ok, 1, value);
    assert.equal(result.text, expected, value);
  }
}

for (const payload of [
  "plain 世界",
  "line\\nfeed",
  "solidus\\/quote\\\"",
  "\\u0000",
  "\\ud800",
  "\\ud83d\\ude03",
]) {
  const expected = JSON.stringify(JSON.parse(`"${payload}"`));
  const kind = payload.includes("\\") ? "serializeEscaped" : "serializeClean";
  const result = invoke(kind, encoder.encode(payload));
  assert.equal(result.ok, 1, payload);
  assert.equal(result.text, expected, payload);
}

for (const value of ["\ud800", "\udc00", "x\ud800y", "😃"]) {
  const expected = JSON.stringify(value);
  const result = invoke("serializeCanonical", encoder.encode(expected));
  assert.equal(result.ok, 1, value);
  assert.equal(result.text, expected, value);
}

let state = 0x9e37_79b9;
for (let index = 0; index < 2000; index++) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  let value = "";
  const length = state & 63;
  for (let char = 0; char < length; char++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const choice = state % 8;
    value += choice === 0 ? '"' :
      choice === 1 ? "\\" :
      choice === 2 ? String.fromCharCode(state & 31) :
      choice === 3 ? "世" :
      choice === 4 ? "😃" :
      String.fromCharCode(0x20 + (state % 95));
  }
  const expected = JSON.stringify(value);
  const result = invoke("serializeRaw", encoder.encode(value));
  assert.equal(result.text, expected);
}

for (const value of ["plain", 'quote " slash \\', "\u0000\u001f", "世界😃"]) {
  const input = encoder.encode(value);
  const expected = encoder.encode(JSON.stringify(value));
  bytes.set(input, sourceBase);
  bytes.fill(0xa5, output, output + expected.length + 16);
  api.begin(output, expected.length - 1);
  assert.equal(api.serializeRaw(sourceBase, input.length), 0);
  assert.equal(api.finish(), 0);
  assert.equal(api.required(), expected.length);
  assert.deepEqual(
    bytes.slice(output, output + expected.length + 8),
    new Uint8Array(expected.length + 8).fill(0xa5),
  );

  api.begin(output, expected.length);
  assert.equal(api.serializeRaw(sourceBase, input.length), 1);
  assert.equal(api.finish(), expected.length);
  assert.deepEqual(bytes.slice(output, output + expected.length), expected);
}

console.log("bounded UTF-8 SWAR string serialization: all tests passed");


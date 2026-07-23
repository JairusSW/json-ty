import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let memory;
const imports = {
  env: {
    abort() { throw new Error("unexpected abort"); },
    parseNumberSlow(pointer, length) {
      const source = new TextDecoder().decode(
        new Uint8Array(memory.buffer, pointer, length),
      );
      return Number(source);
    },
  },
};
const { instance } = await WebAssembly.instantiate(
  await readFile(new URL("../../build/swar-port/float.wasm", import.meta.url)),
  imports,
);
const api = instance.exports;
memory = api.memory;
const bytes = new Uint8Array(memory.buffer);
const encoder = new TextEncoder();

function put(source, offset = 2048) {
  const encoded = encoder.encode(source);
  bytes.set(encoded, offset);
  return [offset, offset + encoded.length];
}

function bits(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  return view.getBigUint64(0, true);
}

for (const source of [
  "0", "-0", "1", "-1", "1.5", "0.000001", "12345678.90123456",
  "9007199254740991", "9007199254740992", "9007199254740993",
  "1e-308", "1e308", "5e-324", "1.7976931348623157e308",
  "2.2250738585072014e-308", "0.10000000000000000555",
]) {
  const [start, end] = put(source);
  assert.equal(api.parse(start, end), end, source);
  assert.equal(bits(api.result()), bits(Number(source)), source);
}

for (const source of [
  "", "-", "+1", ".1", "1.", "01", "-01", "1e", "1e+", "1e-",
]) {
  const [start, end] = put(source);
  assert.equal(api.parse(start, end), 0, source);
}

let [start, end] = put("12.5,tail");
assert.equal(api.parse(start, end), start + 4);
assert.equal(api.result(), 12.5);

let state = 0x1234_5678_9abc_def0n;
const mask = 0xffff_ffff_ffff_ffffn;
const view = new DataView(new ArrayBuffer(8));
for (let index = 0; index < 20_000; index++) {
  state ^= state << 13n;
  state ^= state >> 7n;
  state ^= state << 17n;
  state &= mask;
  view.setBigUint64(0, state, true);
  const value = view.getFloat64(0, true);
  if (!Number.isFinite(value)) continue;
  const source = String(value);
  [start, end] = put(source, 4096);
  assert.equal(api.parse(start, end), end, source);
  assert.equal(bits(api.result()), bits(value), source);
}

for (let length = 1; length <= 15; length++) {
  const source = "1." + "2".repeat(length);
  const encoded = encoder.encode(source);
  const pageEnd = bytes.length;
  const pageStart = pageEnd - encoded.length;
  bytes.set(encoded, pageStart);
  assert.equal(api.parse(pageStart, pageEnd), pageEnd);
}

console.log("checked UTF-8 SWAR floats: all tests passed");


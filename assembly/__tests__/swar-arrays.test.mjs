import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { instance } = await WebAssembly.instantiate(
  await readFile(new URL("../../build/swar-port/arrays.wasm", import.meta.url)),
  { env: { abort() { throw new Error("unexpected abort"); } } },
);
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const view = new DataView(api.memory.buffer);
const encoder = new TextEncoder();
const document = 8192;
const header = document + 64;
const data = header + 16;

function put(source, offset = 32768) {
  const encoded = encoder.encode(source);
  bytes.set(encoded, offset);
  return [offset, offset + encoded.length];
}

function unpackCount(value) {
  const unsigned = BigInt.asUintN(64, value);
  return {
    end: Number(unsigned >> 32n),
    count: Number(unsigned & 0xffff_ffffn),
  };
}

for (let offset = 1; offset <= 15; offset++) {
  const source = "[1, 22,333, 4444,18446744073709551615]";
  const [start, end] = put(source, 32768 + offset);
  assert.deepEqual(unpackCount(api.countU64(start, end)), {
    end,
    count: 5,
  });
  assert.equal(api.parseU64(start, end, document, header, data, 5), end);
  assert.equal(view.getUint32(header, true), 1);
  assert.equal(view.getUint32(header + 4, true), 5);
  assert.equal(view.getUint32(header + 8, true), data - document);
  assert.equal(view.getUint32(header + 12, true), 8);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) =>
      view.getBigUint64(data + index * 8, true)),
    [1n, 22n, 333n, 4444n, 0xffff_ffff_ffff_ffffn],
  );
}

let [start, end] = put("[ true,false, true ]");
assert.deepEqual(unpackCount(api.countBool(start, end)), { end, count: 3 });
assert.equal(api.parseBool(start, end, document, header, data, 3), end);
assert.equal(view.getUint32(header, true), 2);
assert.equal(view.getUint32(header + 4, true), 3);
assert.deepEqual(
  [0, 1, 2].map((index) => view.getUint32(data + index * 4, true)),
  [1, 0, 1],
);

for (const source of [
  "[01]",
  "[-1]",
  "[18446744073709551616]",
  "[1,]",
  "[1 2]",
  "[1",
]) {
  [start, end] = put(source);
  assert.equal(api.parseU64(start, end, document, header, data, 8), 0, source);
}
for (const source of ["[True]", "[falsee]", "[true,]", "[true false]"]) {
  [start, end] = put(source);
  assert.equal(api.parseBool(start, end, document, header, data, 8), 0, source);
}

[start, end] = put("[1,2,3]");
assert.equal(api.parseU64(start, end, document, header, data, 2), 0);

for (let length = 1; length <= 15; length++) {
  const source = "[" + Array.from({ length }, (_, index) => index % 10).join(",") + "]";
  const encoded = encoder.encode(source);
  const pageEnd = bytes.length;
  const pageStart = pageEnd - encoded.length;
  bytes.set(encoded, pageStart);
  assert.equal(
    api.parseU64(pageStart, pageEnd, document, header, data, length),
    pageEnd,
  );
}

console.log("UTF-8 SWAR document arrays: all tests passed");


import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let memory;
const { instance } = await WebAssembly.instantiate(
  await readFile(new URL("../../build/swar-port/document.wasm", import.meta.url)),
  {
    env: {
      abort() { throw new Error("unexpected abort"); },
      parseNumberSlow(pointer, length) {
        return Number(new TextDecoder().decode(
          new Uint8Array(memory.buffer, pointer, length),
        ));
      },
    },
  },
);
const api = instance.exports;
memory = api.memory;
const bytes = new Uint8Array(memory.buffer);
const view = new DataView(memory.buffer);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const document = 8192;
const root = document + 4096;
const graphStart = root + 12;
const graphEnd = document + 28_000;

function parse(source, sourceOffset = 16, limit = graphEnd) {
  const input = typeof source === "string" ? encoder.encode(source) : source;
  const start = document + sourceOffset;
  bytes.set(input, start);
  const result = api.parseDocument(
    start,
    start + input.length,
    document,
    root,
    graphStart,
    limit,
    false,
  );
  return { result, start, end: start + input.length };
}

function sourceString(offset, lengthWord) {
  const length = lengthWord & 0x7fff_ffff;
  const raw = decoder.decode(bytes.subarray(document + offset, document + offset + length));
  return (lengthWord & 0x8000_0000) !== 0 ? JSON.parse(`"${raw}"`) : raw;
}

function decodeSlot(slot) {
  const kind = view.getUint32(slot, true);
  if (kind === 0) return null;
  if (kind === 1) return view.getUint32(slot + 4, true) !== 0;
  if (kind === 2) return view.getFloat64(slot + 4, true);
  if (kind === 3) {
    return sourceString(
      view.getUint32(slot + 4, true),
      view.getUint32(slot + 8, true),
    );
  }
  const header = document + view.getUint32(slot + 4, true);
  const count = view.getUint32(header, true);
  const data = document + view.getUint32(header + 4, true);
  if (kind === 4) {
    const result = [];
    let entry = data;
    for (let index = 0; index < count; index++) {
      result.push(decodeSlot(entry + 4));
      entry = document + view.getUint32(entry, true);
    }
    return result;
  }
  if (kind === 5) {
    const object = {};
    let entry = data;
    for (let index = 0; index < count; index++) {
      const key = sourceString(
        view.getUint32(entry, true),
        view.getUint32(entry + 4, true),
      );
      object[key] = decodeSlot(entry + 12);
      entry = document + view.getUint32(entry + 8, true);
    }
    return object;
  }
  throw new Error(`unknown kind ${kind}`);
}

function objectEntries(slot) {
  const header = document + view.getUint32(slot + 4, true);
  const count = view.getUint32(header, true);
  const data = document + view.getUint32(header + 4, true);
  const entries = [];
  let entry = data;
  for (let index = 0; index < count; index++) {
    entries.push([
      sourceString(view.getUint32(entry, true), view.getUint32(entry + 4, true)),
      decodeSlot(entry + 12),
    ]);
    entry = document + view.getUint32(entry + 8, true);
  }
  return entries;
}

for (let offset = 16; offset <= 31; offset++) {
  const source = '{"a":1,"a":[true,null,"x\\n"],"o":{"k":-0.5}}';
  const { result, end } = parse(source, offset);
  assert.notEqual(result, 0n);
  assert.equal(Number(BigInt.asUintN(64, result) >> 32n), end);
  assert.deepEqual(objectEntries(root), [
    ["a", 1],
    ["a", [true, null, "x\n"]],
    ["o", { k: -0.5 }],
  ]);
}

for (const source of [
  '[1,"x",false,null,{"z":[2,3]}]',
  '{"escaped\\u006bey":"value","unicode":"世界😃"}',
  "[]",
  "{}",
]) {
  const { result } = parse(source);
  assert.notEqual(result, 0n, source);
  assert.deepEqual(decodeSlot(root), JSON.parse(source), source);
}

// Representative typed and dynamic root arrays consume identical syntax.
for (const source of ["[1,2,3]", "[ 1, 22, 333 ]", "[]"]) {
  const { result, start, end } = parse(source);
  assert.notEqual(result, 0n);
  const typedHeader = document + 2048;
  const typedData = typedHeader + 16;
  assert.equal(
    api.parseTypedU64Array(
      start,
      end,
      document,
      typedHeader,
      typedData,
      8,
    ),
    end,
  );
  const length = view.getUint32(typedHeader + 4, true);
  const typed = Array.from({ length }, (_, index) =>
    Number(view.getBigUint64(typedData + index * 8, true)));
  assert.deepEqual(typed, decodeSlot(root));
}

for (const source of ["[01]", "[1,]", "[1 2]"]) {
  const { result, start, end } = parse(source);
  assert.equal(result, 0n, source);
  assert.equal(
    api.parseTypedU64Array(
      start,
      end,
      document,
      document + 2048,
      document + 2064,
      8,
    ),
    0,
    source,
  );
}

{
  const source = "[18446744073709551616]";
  const { start, end } = parse(source);
  assert.equal(
    api.parseTypedU64Array(
      start,
      end,
      document,
      document + 2048,
      document + 2064,
      8,
    ),
    0,
  );
}

let state = 0x1234_5678;
function random() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x1_0000_0000;
}
function value(depth = 0) {
  const choice = depth >= 3 ? Math.floor(random() * 4) : Math.floor(random() * 6);
  if (choice === 0) return null;
  if (choice === 1) return random() < 0.5;
  if (choice === 2) return Number(((random() - 0.5) * 1e12).toPrecision(12));
  if (choice === 3) return `s-${Math.floor(random() * 1000)}-世界`;
  if (choice === 4) return Array.from({ length: Math.floor(random() * 5) }, () => value(depth + 1));
  const object = {};
  for (let index = 0; index < Math.floor(random() * 5); index++) {
    object[`k${index}`] = value(depth + 1);
  }
  return object;
}
for (let index = 0; index < 500; index++) {
  const expected = value();
  const source = JSON.stringify(expected);
  const { result } = parse(source);
  assert.notEqual(result, 0n, source);
  assert.deepEqual(decodeSlot(root), expected, source);
}

for (const source of [
  "[1,]",
  '{"a":1,}',
  '{"a" 1}',
  '{"a":[1,2}',
  '"unterminated',
  "01",
  "true false",
]) {
  const first = parse(source);
  const fault = api.faultOffset();
  assert.equal(first.result, 0n, source);
  assert.equal(parse(source).result, 0n, source);
  assert.equal(api.faultOffset(), fault, source);
}

const deep = "[".repeat(257) + "0" + "]".repeat(257);
assert.equal(parse(deep).result, 0n);

const exhausted = parse('{"a":[1,2,3]}', 16, graphStart + 8);
assert.equal(exhausted.result, 0n);

console.log("UTF-8 SWAR dynamic document: all tests passed");

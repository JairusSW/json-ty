import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

const { instance } = await WebAssembly.instantiate(
  await readFile(new URL("../../build/swar-port/primitives.wasm", import.meta.url)),
  { env: { abort() { throw new Error("unexpected abort"); } } },
);
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const count = 4096;
const rounds = 2000;
const start = 64;

for (let index = 0; index < count; index++) {
  const text = String((index * 7919) % 100_000_000).padStart(8, "0");
  for (let lane = 0; lane < 8; lane++) {
    bytes[start + index * 8 + lane] = text.charCodeAt(lane);
  }
}

function sample(name) {
  const fn = api[name];
  fn(start, count, 10);
  const values = [];
  let checksum;
  for (let iteration = 0; iteration < 9; iteration++) {
    const before = performance.now();
    checksum = fn(start, count, rounds);
    values.push(performance.now() - before);
  }
  values.sort((left, right) => left - right);
  return { milliseconds: values[4], checksum };
}

const swar = sample("benchParse8");
const scalar = sample("benchScalar8");
if (swar.checksum !== scalar.checksum) throw new Error("benchmark checksum mismatch");

const operations = count * rounds;
const swarNs = swar.milliseconds * 1e6 / operations;
const scalarNs = scalar.milliseconds * 1e6 / operations;
console.log(JSON.stringify({
  operations,
  wasmBytes: (await readFile(new URL("../../build/swar-port/primitives.wasm", import.meta.url))).byteLength,
  swarNsPer8Digits: Number(swarNs.toFixed(3)),
  scalarNsPer8Digits: Number(scalarNs.toFixed(3)),
  speedup: Number((scalarNs / swarNs).toFixed(3)),
}));


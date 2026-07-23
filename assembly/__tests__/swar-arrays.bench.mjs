import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

const wasmBytes = await readFile(new URL("../../build/swar-port/arrays.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, {
  env: { abort() { throw new Error("unexpected abort"); } },
});
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const source = "[" +
  Array.from({ length: 2048 }, (_, index) => String(index * 7919 + 17)).join(",") +
  "]";
const payload = new TextEncoder().encode(source);
const start = 32768;
const end = start + payload.length;
bytes.set(payload, start);
const document = 8192;
const header = document + 64;
const data = header + 16;
const iterations = 4000;

function median(name, args) {
  const fn = api[name];
  fn(...args.slice(0, -1), 2000);
  const samples = [];
  let checksum;
  for (let index = 0; index < 9; index++) {
    const before = performance.now();
    checksum = fn(...args);
    samples.push(performance.now() - before);
  }
  samples.sort((left, right) => left - right);
  return { milliseconds: samples[4], checksum };
}

const swarArgs = [start, end, document, header, data, 2048, iterations];
const scalarArgs = [start, end, document, header, data, 2048, iterations];
const swar = median("benchU64Swar", swarArgs);
const scalar = median("benchU64Scalar", scalarArgs);
if (swar.checksum !== scalar.checksum) throw new Error("checksum mismatch");
const swarNs = swar.milliseconds * 1e6 / iterations;
const scalarNs = scalar.milliseconds * 1e6 / iterations;
console.log(JSON.stringify({
  payloadBytes: payload.length,
  elements: 2048,
  wasmBytes: wasmBytes.byteLength,
  swarNsPerArray: Number(swarNs.toFixed(2)),
  scalarNsPerArray: Number(scalarNs.toFixed(2)),
  speedup: Number((scalarNs / swarNs).toFixed(3)),
}));


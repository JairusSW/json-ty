import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

let memory;
const wasmBytes = await readFile(new URL("../../build/swar-port/float.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, {
  env: {
    abort() { throw new Error("unexpected abort"); },
    parseNumberSlow(pointer, length) {
      return Number(new TextDecoder().decode(new Uint8Array(memory.buffer, pointer, length)));
    },
  },
});
const api = instance.exports;
memory = api.memory;
const bytes = new Uint8Array(memory.buffer);
const encoder = new TextEncoder();
const start = 4096;
const series = [
  "12345678",
  "12345678.25",
  "12.3456",
  "1.12345678",
  "123.123456789012",
  "1.1234567890123456",
];

function median(name, end, iterations) {
  const fn = api[name];
  fn(start, end, 10);
  const samples = [];
  let checksum;
  for (let index = 0; index < 9; index++) {
    const before = performance.now();
    checksum = fn(start, end, iterations);
    samples.push(performance.now() - before);
  }
  samples.sort((left, right) => left - right);
  return { milliseconds: samples[4], checksum };
}

const results = [];
for (const source of series) {
  const payload = encoder.encode(source);
  bytes.set(payload, start);
  const end = start + payload.length;
  const iterations = 10_000_000;
  const swar = median("benchPacked4", end, iterations);
  const scalar = median("benchScalar", end, iterations);
  const simdjson8 = median("benchSwar", end, iterations);
  if (swar.checksum !== scalar.checksum || swar.checksum !== simdjson8.checksum) throw new Error(`${source} checksum mismatch`);
  const swarNs = swar.milliseconds * 1e6 / iterations;
  const scalarNs = scalar.milliseconds * 1e6 / iterations;
  const simdjson8Ns = simdjson8.milliseconds * 1e6 / iterations;
  results.push({
    source,
    swarNsPerValue: Number(swarNs.toFixed(3)),
    scalarNsPerValue: Number(scalarNs.toFixed(3)),
    speedup: Number((scalarNs / swarNs).toFixed(3)),
    simdjson8NsPerValue: Number(simdjson8Ns.toFixed(3)),
    simdjson8VsCurrent: Number((swarNs / simdjson8Ns).toFixed(3)),
  });
}
console.log(JSON.stringify({ wasmBytes: wasmBytes.byteLength, results }));

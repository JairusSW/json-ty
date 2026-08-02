import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

const wasmBytes = await readFile(new URL("../../build/swar-port/simd-structural-scanner.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, {
  env: {
    abort() {
      throw new Error("unexpected abort");
    },
  },
});
const api = instance.exports;
const memory = new Uint8Array(api.memory.buffer);
const encoder = new TextEncoder();
const start = 1024;
const records = Array.from({ length: 384 }, (_, index) => ({
  id: index * 7919,
  active: (index & 1) === 0,
  label: `record-${index}-abcdefghijklmnopqrstuvwxyz`,
}));
const series = {
  numericArray: `[${Array.from({ length: 4096 }, (_, index) => String(index * 7919)).join(",")}]`,
  stringArray: JSON.stringify(records.map((record) => record.label)),
  objectArray: JSON.stringify(records),
  prettyObjects: JSON.stringify(records, null, 2),
  escapedStrings: JSON.stringify(Array.from({ length: 1024 }, (_, index) => `row-${index}-\\\\\\\"-[{]}-tail`)),
};

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
for (const [name, source] of Object.entries(series)) {
  const payload = encoder.encode(source);
  if (start + payload.length > memory.length) throw new Error(`${name} exceeds benchmark memory`);
  memory.set(payload, start);
  const end = start + payload.length;
  const iterations = Math.max(1500, Math.floor(140_000_000 / payload.length));
  const simd = median("benchSimd", end, iterations);
  const swar = median("benchSwar", end, iterations);
  const parity = median("benchParity", end, iterations);
  if (simd.checksum !== swar.checksum || simd.checksum !== parity.checksum) throw new Error(`${name} checksum mismatch`);
  const simdNs = (simd.milliseconds * 1e6) / iterations;
  const swarNs = (swar.milliseconds * 1e6) / iterations;
  const parityNs = (parity.milliseconds * 1e6) / iterations;
  results.push({
    name,
    payloadBytes: payload.length,
    simdNsPerValue: Number(simdNs.toFixed(2)),
    swarNsPerValue: Number(swarNs.toFixed(2)),
    gibPerSecond: Number((payload.length / simdNs).toFixed(3)),
    speedup: Number((swarNs / simdNs).toFixed(3)),
    parityNsPerValue: Number(parityNs.toFixed(2)),
    parityVsCurrent: Number((simdNs / parityNs).toFixed(3)),
  });
}

console.log(JSON.stringify({ wasmBytes: wasmBytes.byteLength, results }));

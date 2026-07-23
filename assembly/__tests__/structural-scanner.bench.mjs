import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

const wasmBytes = await readFile(
  new URL("../../build/swar-port/structural-scanner.wasm", import.meta.url),
);
const { instance } = await WebAssembly.instantiate(wasmBytes, {
  env: { abort() { throw new Error("unexpected abort"); } },
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
  numericArray: "[" +
    Array.from({ length: 4096 }, (_, index) => String(index * 7919)).join(",") +
    "]",
  stringArray: JSON.stringify(records.map((record) => record.label)),
  objectArray: JSON.stringify(records),
  prettyObjects: JSON.stringify(records, null, 2),
};

function sample(name, end, iterations) {
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
  if (start + payload.length > memory.length) {
    throw new Error(`${name} exceeds benchmark memory`);
  }
  memory.set(payload, start);
  const end = start + payload.length;
  const iterations = Math.max(1500, Math.floor(140_000_000 / payload.length));
  const swar = sample("benchScan", end, iterations);
  const scalar = sample("benchScalar", end, iterations);
  if (swar.checksum !== scalar.checksum) {
    throw new Error(`${name} checksum mismatch`);
  }
  const swarNs = swar.milliseconds * 1e6 / iterations;
  const scalarNs = scalar.milliseconds * 1e6 / iterations;
  results.push({
    name,
    payloadBytes: payload.length,
    iterations,
    swarNsPerValue: Number(swarNs.toFixed(2)),
    scalarNsPerValue: Number(scalarNs.toFixed(2)),
    gibPerSecond: Number((payload.length / swarNs).toFixed(3)),
    speedup: Number((scalarNs / swarNs).toFixed(3)),
  });
}

console.log(JSON.stringify({ wasmBytes: wasmBytes.byteLength, results }));


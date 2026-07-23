import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

let memory;
const wasmBytes = await readFile(new URL("../../build/swar-port/document.wasm", import.meta.url));
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
const document = 8192;
const sourceStart = document + 16;
const root = document + 32_000;
const graphStart = root + 16;
const graphEnd = bytes.length;
const records = Array.from({ length: 100 }, (_, index) => ({
  id: index * 7919,
  active: (index & 1) === 0,
  name: `record-${index}`,
  values: [index + 0.25, index + 1.5, null],
}));
const series = {
  compact: JSON.stringify(records),
  pretty: JSON.stringify(records, null, 2),
};

function median(end, iterations) {
  api.benchDocument(sourceStart, end, document, root, graphStart, graphEnd, true, 10);
  const samples = [];
  let checksum;
  for (let index = 0; index < 9; index++) {
    const before = performance.now();
    checksum = api.benchDocument(
      sourceStart,
      end,
      document,
      root,
      graphStart,
      graphEnd,
      true,
      iterations,
    );
    samples.push(performance.now() - before);
  }
  samples.sort((left, right) => left - right);
  return { milliseconds: samples[4], checksum };
}

const results = [];
for (const [name, source] of Object.entries(series)) {
  const payload = encoder.encode(source);
  bytes.set(payload, sourceStart);
  const iterations = Math.max(1000, Math.floor(100_000_000 / payload.length));
  const measured = median(sourceStart + payload.length, iterations);
  const ns = measured.milliseconds * 1e6 / iterations;
  results.push({
    name,
    payloadBytes: payload.length,
    nsPerDocument: Number(ns.toFixed(2)),
    gibPerSecond: Number((payload.length / ns).toFixed(3)),
  });
}
console.log(JSON.stringify({ wasmBytes: wasmBytes.byteLength, results }));


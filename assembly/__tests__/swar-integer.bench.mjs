import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

const wasmBytes = await readFile(new URL("../../build/swar-port/integer.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, {
  env: { abort() { throw new Error("unexpected abort"); } },
});
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const start = 8192;
const count = 2048;

function median(name, width, rounds) {
  const fn = api[name];
  fn(start, width, count, 10);
  const samples = [];
  let checksum;
  for (let index = 0; index < 9; index++) {
    const before = performance.now();
    checksum = fn(start, width, count, rounds);
    samples.push(performance.now() - before);
  }
  samples.sort((left, right) => left - right);
  return { milliseconds: samples[4], checksum };
}

const results = [];
for (const width of [4, 8, 16]) {
  for (let index = 0; index < count; index++) {
    const source = String((index % 9) + 1) +
      String(index * 7919 + 17).padStart(width - 1, "0").slice(-(width - 1));
    for (let lane = 0; lane < width; lane++) {
      bytes[start + index * width + lane] = source.charCodeAt(lane);
    }
  }
  const rounds = Math.floor(20_000_000 / count);
  const swar = median("benchUnsignedSwar", width, rounds);
  const scalar = median("benchUnsignedScalar", width, rounds);
  if (swar.checksum !== scalar.checksum) throw new Error(`width ${width} checksum mismatch`);
  const operations = count * rounds;
  const swarNs = swar.milliseconds * 1e6 / operations;
  const scalarNs = scalar.milliseconds * 1e6 / operations;
  results.push({
    digits: width,
    swarNsPerValue: Number(swarNs.toFixed(3)),
    scalarNsPerValue: Number(scalarNs.toFixed(3)),
    speedup: Number((scalarNs / swarNs).toFixed(3)),
  });
}
console.log(JSON.stringify({ wasmBytes: wasmBytes.byteLength, results }));


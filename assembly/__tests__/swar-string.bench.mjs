import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

const wasmBytes = await readFile(new URL("../../build/swar-port/string.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, {
  env: { abort() { throw new Error("unexpected abort"); } },
});
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const encoder = new TextEncoder();
const start = 1024;
const series = [
  ["strictAscii", '"' + "abcdefghijklmno".repeat(2048) + '"', false],
  ["strictSparseEscapes", '"' + "abcdefghijklmno\\n".repeat(1800) + '"', false],
  ["strictUnicode", '"' + "héllø世界😃".repeat(1600) + '"', false],
  ["trustedUnicode", '"' + "héllø世界😃".repeat(1600) + '"', true],
];

function median(name, end, iterations, trusted) {
  const fn = api[name];
  fn(start, end, 10, trusted);
  const samples = [];
  let checksum;
  for (let index = 0; index < 9; index++) {
    const before = performance.now();
    checksum = fn(start, end, iterations, trusted);
    samples.push(performance.now() - before);
  }
  samples.sort((left, right) => left - right);
  return { milliseconds: samples[4], checksum };
}

const results = [];
for (const [name, source, trusted] of series) {
  const payload = encoder.encode(source);
  bytes.set(payload, start);
  const end = start + payload.length;
  const iterations = Math.max(2000, Math.floor(160_000_000 / payload.length));
  const swar = median("benchSwar", end, iterations, trusted);
  const scalar = median("benchScalar", end, iterations, trusted);
  if (swar.checksum !== scalar.checksum) throw new Error(`${name} checksum mismatch`);
  const swarNs = swar.milliseconds * 1e6 / iterations;
  const scalarNs = scalar.milliseconds * 1e6 / iterations;
  results.push({
    name,
    payloadBytes: payload.length,
    swarNsPerString: Number(swarNs.toFixed(2)),
    scalarNsPerString: Number(scalarNs.toFixed(2)),
    gibPerSecond: Number((payload.length / swarNs).toFixed(3)),
    speedup: Number((scalarNs / swarNs).toFixed(3)),
  });
}
console.log(JSON.stringify({ wasmBytes: wasmBytes.byteLength, results }));


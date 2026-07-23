import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";

const wasmBytes = await readFile(new URL("../../build/swar-port/serialize-string.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, {
  env: { abort() { throw new Error("unexpected abort"); } },
});
const api = instance.exports;
const bytes = new Uint8Array(api.memory.buffer);
const encoder = new TextEncoder();
const source = 8192;
const output = 36000;
const series = {
  cleanAscii: "abcdefghijklmno".repeat(1800),
  cleanUnicode: "héllø世界😃".repeat(1100),
  sparseEscapes: 'abcdefghijklmno"'.repeat(1500),
  escapeHeavy: '"\\\n\t\u0000'.repeat(2000),
};

function median(name, length, capacity, iterations) {
  const fn = api[name];
  fn(source, length, output, capacity, 1000);
  const samples = [];
  let checksum;
  for (let index = 0; index < 9; index++) {
    const before = performance.now();
    checksum = fn(source, length, output, capacity, iterations);
    samples.push(performance.now() - before);
  }
  samples.sort((left, right) => left - right);
  return { milliseconds: samples[4], checksum };
}

const results = [];
for (const [name, value] of Object.entries(series)) {
  const input = encoder.encode(value);
  bytes.set(input, source);
  const capacity = encoder.encode(JSON.stringify(value)).length;
  const iterations = Math.max(2000, Math.floor(140_000_000 / input.length));
  const swar = median("benchSwar", input.length, capacity, iterations);
  const scalar = median("benchScalar", input.length, capacity, iterations);
  if (swar.checksum !== scalar.checksum) throw new Error(`${name} checksum mismatch`);
  const swarNs = swar.milliseconds * 1e6 / iterations;
  const scalarNs = scalar.milliseconds * 1e6 / iterations;
  results.push({
    name,
    inputBytes: input.length,
    swarNsPerString: Number(swarNs.toFixed(2)),
    scalarNsPerString: Number(scalarNs.toFixed(2)),
    gibPerSecond: Number((input.length / swarNs).toFixed(3)),
    speedup: Number((scalarNs / swarNs).toFixed(3)),
  });
}

const retainedInput = encoder.encode(series.cleanAscii);
bytes.set(retainedInput, source);
const retainedIterations = 6000;
const retained = median(
  "benchRetained",
  retainedInput.length,
  retainedInput.length + 2,
  retainedIterations,
);
results.push({
  name: "retainedClean",
  inputBytes: retainedInput.length,
  nsPerString: Number((retained.milliseconds * 1e6 / retainedIterations).toFixed(2)),
});

console.log(JSON.stringify({ wasmBytes: wasmBytes.byteLength, results }));


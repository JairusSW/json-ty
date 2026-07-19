import { readFileSync } from "node:fs";
import { RawNodeBinding, createObjectView } from "../src/raw/node-binding.js";

const wasmBytes = readFileSync("build/raw/runtime.wasm");
const runtime = new RawNodeBinding(wasmBytes, {
  scratchCapacity: 1 << 20,
  heapReserve: 16 << 20,
});
const [layout] = JSON.parse(readFileSync("build/raw/schema-layouts.json", "utf8"));
const Schema = { ...layout, View: createObjectView(layout) };

const inputs = Array.from({ length: 1024 }, (_, index) => `{"id":${index},"value":${index + 0.25},"label":"metric-${index}","ok":${index & 1 ? "true" : "false"}}`);
const nativeValues = inputs.map((input) => JSON.parse(input));
const inputBuffers = inputs.map((input) => Buffer.from(input));
const bytes = inputs.reduce((total, input) => total + Buffer.byteLength(input), 0) / inputs.length;

function measure(name, operation, iterations, bytesPerOperation = bytes) {
  let checksum = 0;
  for (let index = 0; index < 10_000; index++) checksum += operation(index);
  const start = performance.now();
  for (let index = 0; index < iterations; index++) checksum += operation(index);
  const elapsed = performance.now() - start;
  const ops = iterations / (elapsed / 1000);
  const throughput = (bytesPerOperation * ops) / 1e6;
  console.log(`${name.padEnd(28)} ${Math.round(ops).toLocaleString().padStart(14)} ops/s  ${Math.round(throughput).toLocaleString().padStart(7)} MB/s  checksum=${checksum}`);
}

const iterations = 250_000;

measure(
  "native parse + read all",
  (index) => {
    const value = JSON.parse(inputs[index & 1023]);
    return value.id + value.value + value.label.length + (value.ok ? 1 : 0);
  },
  iterations,
);

measure(
  "raw parse + view + read all",
  (index) => {
    const value = runtime.parse(Schema, inputs[index & 1023]);
    const result = value.id + value.value + value.label.length + (value.ok ? 1 : 0);
    value.dispose();
    return result;
  },
  iterations,
);

measure(
  "native Buffer parse + read",
  (index) => {
    const value = JSON.parse(inputBuffers[index & 1023]);
    return value.id + value.value + value.label.length + (value.ok ? 1 : 0);
  },
  iterations,
);

measure(
  "raw Buffer parse + read",
  (index) => {
    const value = runtime.parse(Schema, inputBuffers[index & 1023]);
    const result = value.id + value.value + value.label.length + (value.ok ? 1 : 0);
    value.dispose();
    return result;
  },
  iterations,
);

measure(
  "raw parse + view only",
  (index) => {
    const value = runtime.parse(Schema, inputs[index & 1023]);
    const pointer = value.__document;
    value.dispose();
    return pointer;
  },
  iterations,
);

measure(
  "raw parse + numeric reads",
  (index) => {
    const value = runtime.parse(Schema, inputs[index & 1023]);
    const result = value.id + value.value + (value.ok ? 1 : 0);
    value.dispose();
    return result;
  },
  iterations,
);

measure(
  "raw parse + string read",
  (index) => {
    const value = runtime.parse(Schema, inputs[index & 1023]);
    const result = value.label.length;
    value.dispose();
    return result;
  },
  iterations,
);

const stringifyRuntime = new RawNodeBinding(wasmBytes, {
  scratchCapacity: 1 << 20,
  heapReserve: 16 << 20,
});
const StringifySchema = { ...layout, View: createObjectView(layout) };
const rawValues = inputs.map((input) => stringifyRuntime.parse(StringifySchema, input));

measure(
  "native stringify",
  (index) => {
    return JSON.stringify(nativeValues[index & 1023]).length;
  },
  iterations,
);

measure(
  "raw stringify retained",
  (index) => {
    return stringifyRuntime.stringify(StringifySchema, rawValues[index & 1023]).length;
  },
  iterations,
);

measure(
  "generated JS stringify",
  (index) => {
    return stringifyRuntime.stringifyJS(StringifySchema, nativeValues[index & 1023]).length;
  },
  iterations,
);

measure(
  "plain via Wasm stringify",
  (index) => {
    return stringifyRuntime.stringifyWasm(StringifySchema, nativeValues[index & 1023]).length;
  },
  iterations,
);

measure(
  "native parse + stringify",
  (index) => {
    return JSON.stringify(JSON.parse(inputs[index & 1023])).length;
  },
  iterations,
);

measure(
  "raw parse + stringify",
  (index) => {
    const value = stringifyRuntime.parse(StringifySchema, inputs[index & 1023]);
    const length = stringifyRuntime.stringify(StringifySchema, value).length;
    value.dispose();
    return length;
  },
  iterations,
);

const retainedRuntime = new RawNodeBinding(wasmBytes, {
  scratchCapacity: 1 << 20,
  heapReserve: 64 << 20,
});
const RetainedSchema = { ...layout, View: createObjectView(layout) };
measure(
  "raw retained view + read all",
  (index) => {
    const value = retainedRuntime.parse(RetainedSchema, inputs[index & 1023]);
    return value.id + value.value + value.label.length + (value.ok ? 1 : 0);
  },
  100_000,
);

const kernelRuntime = new RawNodeBinding(wasmBytes, {
  scratchCapacity: 1 << 20,
  heapReserve: 64 << 20,
});
const parseMetric = kernelRuntime.exports.parseMetric;
measure(
  "Buffer.write only",
  (index) => {
    return kernelRuntime._writeInput(inputs[index & 1023]);
  },
  iterations,
);

measure(
  "raw kernel + retained doc",
  (index) => {
    const input = inputs[index & 1023];
    const length = kernelRuntime._writeInput(input);
    return parseMetric(kernelRuntime.scratch, length) >>> 0;
  },
  100_000,
);

const releasedKernelRuntime = new RawNodeBinding(wasmBytes, {
  scratchCapacity: 1 << 20,
  heapReserve: 16 << 20,
});
const releasedParseMetric = releasedKernelRuntime.exports.parseMetric;
const releasedDocument = releasedKernelRuntime.exports.releaseDocument;
measure(
  "raw kernel + release",
  (index) => {
    const input = inputs[index & 1023];
    const length = releasedKernelRuntime._writeInput(input);
    const document = releasedParseMetric(releasedKernelRuntime.scratch, length) >>> 0;
    releasedDocument(document);
    return document;
  },
  iterations,
);

// Exact payload used by json-as' checked-in Vec3 SIMD benchmark. This includes
// UTF-8 ingress and explicit release; json-as' number below is its resident
// managed-object kernel as reported by bench/run-json-as-artifact.mjs.
const vec3Parse = releasedKernelRuntime.exports.parseVec3;
const vec3Input = '{"x":1,"y":2,"z":3}';
const vec3Length = releasedKernelRuntime._writeInput(vec3Input);
measure(
  "raw Vec3 resident + release",
  () => {
    const document = vec3Parse(releasedKernelRuntime.scratch, vec3Length) >>> 0;
    releasedDocument(document);
    return document;
  },
  2_000_000,
  Buffer.byteLength(vec3Input),
);
measure(
  "raw Vec3 kernel + release",
  () => {
    const length = releasedKernelRuntime._writeInput(vec3Input);
    const document = vec3Parse(releasedKernelRuntime.scratch, length) >>> 0;
    releasedDocument(document);
    return document;
  },
  2_000_000,
  Buffer.byteLength(vec3Input),
);

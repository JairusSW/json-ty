import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { RawNodeBinding, createSchemaRegistry } from "../src/raw/node-binding.js";
import { payloads } from "./overview/payloads.mjs";

const runtime = new RawNodeBinding(readFileSync("build/overview/runtime.wasm"), {
  scratchCapacity: 16 << 20,
  heapReserve: 64 << 20,
});
const schemas = createSchemaRegistry(JSON.parse(readFileSync("build/overview/schema-layouts.json", "utf8")));
const targetMs = Number(process.env.JSON_TY_PROFILE_MS ?? 120);
let sink = 0;

function measure(operation) {
  let batch = 1;
  let elapsed = 0;
  while (elapsed < 15) {
    const start = performance.now();
    for (let index = 0; index < batch; index++) sink ^= operation() | 0;
    elapsed = performance.now() - start;
    if (elapsed < 15) batch *= 2;
  }
  const count = Math.ceil((batch * targetMs) / elapsed);
  const start = performance.now();
  for (let index = 0; index < count; index++) sink ^= operation() | 0;
  const seconds = (performance.now() - start) / 1000;
  return count / seconds;
}

function print(label, ops, bytes) {
  const mbps = (ops * bytes) / 1e6;
  console.log(`${label.padEnd(30)} ${(ops / 1e6).toFixed(2).padStart(8)} M/s ${Math.round(mbps).toLocaleString().padStart(8)} MB/s`);
}

for (const payload of payloads.filter((item) => item.schema !== null)) {
  const schema = schemas.get(payload.schema);
  const parse = runtime.exports[`parse${schema.name}`];
  const serialize = runtime.exports[`serialize${schema.name}`];
  const release = runtime.exports.releaseDocument;
  const residentLength = runtime._writeInput(payload.buffer);
  const retained = runtime.parse(schema, payload.buffer);
  serialize(retained.__document, runtime.scratch, runtime.scratchCapacity - 128);
  const output = runtime._result(20);
  const outputLength = runtime._result(24);
  const alternateJson = `${payload.json} `;
  let alternate = false;

  console.log(`\n${payload.key} (${payload.bytes} bytes)`);
  print(
    "string UTF-8 ingress",
    measure(() => runtime._writeInput(payload.json)),
    payload.bytes,
  );
  print(
    "string ingress alternating",
    measure(() => runtime._writeInput((alternate = !alternate) ? payload.json : alternateJson)),
    payload.bytes,
  );
  print(
    "Buffer.copy ingress",
    measure(() => runtime._writeInput(payload.buffer)),
    payload.bytes,
  );
  print(
    "parse kernel resident",
    measure(() => {
      const document = parse(runtime.scratch, residentLength) >>> 0;
      release(document);
      return document;
    }),
    payload.bytes,
  );
  print(
    "parse + Buffer.copy",
    measure(() => {
      const length = runtime._writeInput(payload.buffer);
      const document = parse(runtime.scratch, length) >>> 0;
      release(document);
      return document;
    }),
    payload.bytes,
  );
  print(
    "binding parse string",
    measure(() => {
      const value = runtime.parse(schema, payload.json);
      const document = value.__document;
      value.dispose();
      return document;
    }),
    payload.bytes,
  );
  print(
    "binding string alternating",
    measure(() => {
      const value = runtime.parse(schema, (alternate = !alternate) ? payload.json : alternateJson);
      const document = value.__document;
      value.dispose();
      return document;
    }),
    payload.bytes,
  );
  print(
    "binding parse + view",
    measure(() => {
      const value = runtime.parse(schema, payload.buffer);
      const document = value.__document;
      value.dispose();
      return document;
    }),
    payload.bytes,
  );
  print(
    "serialize kernel",
    measure(() => {
      serialize(retained.__document, runtime.scratch, runtime.scratchCapacity - 128);
      return runtime._result(24);
    }),
    payload.bytes,
  );
  print(
    "Buffer.toString only",
    measure(() => runtime.buffer.toString("utf8", output, output + outputLength).length),
    payload.bytes,
  );
  print(
    "binding stringify",
    measure(() => runtime.stringify(schema, retained).length),
    payload.bytes,
  );
  retained.dispose();
}

console.log(`\nsink=${sink}`);

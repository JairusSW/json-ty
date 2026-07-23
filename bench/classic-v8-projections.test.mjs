import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RawNodeBinding } from "../src/raw/node-binding.js";
import { projections } from "./classic/projections.mjs";

const payloadRoot = resolve(process.env.JSON_TY_CLASSIC_PAYLOADS ?? "../json-as/assembly/__benches__/payloads");
const runtime = new RawNodeBinding(readFileSync("build/classic/runtime.wasm"), {
  scratchCapacity: 128 << 20,
  heapReserve: 64 << 20,
});

function residentSource(file) {
  const source = readFileSync(resolve(payloadRoot, file), "utf8");
  const length = runtime._writeInput(source, false, 1);
  return { source, pointer: runtime.scratch, length };
}

{
  const { source, pointer, length } = residentSource("lottie.min.json");
  const expected = projections.lottie(JSON.parse(source));
  const actual = runtime.exports.projectLottieOnceTrusted(pointer, length);
  assert.ok(Math.abs(actual - expected) < 1e-9, `lottie projection ${actual} != ${expected}`);
}

{
  const { source, pointer, length } = residentSource("citm_catalog.min.json");
  const expected = projections.citm_catalog(JSON.parse(source));
  const actual = runtime.exports.projectCitmOnceTrusted(pointer, length);
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected) * 1e-15), `CITM projection ${actual} != ${expected}`);
}

for (const [corpus, file] of [
  ["otfcc", "otfcc.min.json"],
  ["fgo", "fgo.min.json"],
]) {
  const { source, pointer, length } = residentSource(file);
  const expected = projections[corpus](JSON.parse(source));
  assert.equal(runtime.exports.projectRootKindsOnceTrusted(pointer, length), expected, corpus);
}

console.log("classic resident raw projections: all tests passed");

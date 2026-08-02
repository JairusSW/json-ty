import assert from "node:assert/strict";
import { generateAssemblyModule } from "../../dist/compiler/record-codegen/index.js";

const generatedModule = generateAssemblyModule([
  {
    name: "Item",
    fields: [
      { name: "id", kind: "number", defaultValue: 0 },
      { name: "count", kind: "number", decorators: { lazy: true } },
      { name: "name", kind: "string" },
      { name: "active", kind: "boolean" },
    ],
  },
  {
    name: "Envelope",
    fields: [
      { name: "item", kind: "object", type: { kind: "object", typeName: "Item" }, decorators: { lazy: true } },
      { name: "values", kind: "array", type: { kind: "array", element: { kind: "number" }, facade: "array" }, decorators: { lazy: true } },
    ],
  },
]);
const generated = generatedModule.assembly;

for (const module of ["deserialize/number", "deserialize/null", "deserialize/string", "deserialize/boolean", "deserialize/array", "deserialize/struct", "serialize/number", "serialize/null", "serialize/string", "serialize/boolean", "serialize/array", "serialize/struct", "layout/document"]) {
  assert.match(generated, new RegExp(`from ".*${module}"`));
}

for (const call of ["deserializeF64(cursor", "deserializeString(cursor", "deserializeBoolean(cursor", "serializeF64(load<f64>", "serializeString(document", "serializeBoolean(load<u32>", "initializeArray(header", "beginStructReader(cursor", "beginStructWriter()", "beginArray()"]) {
  assert.ok(generated.includes(call), `generated module should call ${call}`);
}

assert.match(generated, /function parseEnvelopeRecord\(/);
assert.match(generated, /function serializeEnvelopeRecord\(/);
assert.match(generated, /function parseGraphArray\d+\(/);
assert.match(generated, /function serializeGraphArray\d+\(/);
assert.match(generated, /graphReserveScratch\(/);
assert.match(generated, /export function materializeItemField\(/);
assert.match(generated, /export function materializeEnvelopeField\(/);
assert.match(generated, /lazy \|= 0x/);
assert.match(generated, /else if \(\(lazy & 0x/);
assert.ok(generatedModule.layouts.find((layout) => layout.name === "Item").lazyOffset >= 0);
assert.ok(generatedModule.layouts.find((layout) => layout.name === "Envelope").lazyOffset >= 0);
assert.deepEqual(generatedModule.layouts[0].abi, {
  index: 0,
  parse: "p0",
  parseTrusted: "t0",
  parseInto: "pi0",
  parseIntoTrusted: "pu0",
  serialize: "s0",
  materialize: "m0",
});
assert.match(generated, /export function p0\(/);
assert.match(generated, /export function t0\(/);
assert.match(generated, /export function pi0\(/);
assert.match(generated, /export function pu0\(/);
assert.match(generated, /export function s0\(/);
assert.match(generated, /export function m0\(/);
assert.match(generated, /const defaultTotal: u32/);
assert.match(generated, /scratchChunk = graphReserveScratch/);
assert.match(generated, /memory\.copy\(\s*data \+ <usize>copied/);
assert.doesNotMatch(generated, /maximumCount/);
assert.doesNotMatch(generated, /inspectArray/);
assert.doesNotMatch(generated, /\bnew\s+[A-Z_a-z]/);
assert.doesNotMatch(generated, /:\s*(?:string|Array<|StaticArray<|Map<|Set<)/);

console.log("AssemblyScript kernel codegen contract: all tests passed");

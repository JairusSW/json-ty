import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { prepareArtifactCompilation } from "../../dist/compiler/artifact-compiler.js";
import { RawNodeBinding, createSchemaRegistry } from "../../src/raw/node-binding.js";

const fields = Array.from({ length: 150 }, (_, index) => ({
  name: `f${index}`,
  kind: index % 3 === 0 ? "number" : index % 3 === 1 ? "boolean" : "string",
  ...(index === 63 || index === 127 ? { decorators: { lazy: true } } : {}),
}));
const graphFields = fields.map((field, index) => index === 75
  ? { name: field.name, kind: "object", type: { kind: "object", typeName: "WideChild" } }
  : field);
mkdirSync("build", { recursive: true });
const directory = mkdtempSync(resolve("build/wide-test-"));
let runtimeImportBase = relative(directory, resolve("assembly")).replaceAll("\\", "/");
if (!runtimeImportBase.startsWith(".")) runtimeImportBase = `./${runtimeImportBase}`;
const schemas = [
  { name: "Wide", fields },
  { name: "EscapedKey", fields: [{ name: "value", jsonName: 'a"b\nc', kind: "number" }] },
  { name: "Lexical", fields: [{ name: "n", kind: "number" }, { name: "s", kind: "string" }] },
  { name: "WideChild", fields: [{ name: "value", kind: "number" }] },
  { name: "WideGraph", fields: graphFields },
];
const compilation = prepareArtifactCompilation({ schemas, directory, runtimeImportBase });
const generated = {
  assembly: readFileSync(compilation.artifact.assemblyPath, "utf8"),
  layouts: compilation.artifact.layouts,
};
const layout = generated.layouts[0];
const graphLayout = generated.layouts.find((candidate) => candidate.name === "WideGraph");
assert.match(generated.assembly, /function parseWideOrderedChunk0/);
assert.match(generated.assembly, /function parseWideOrderedChunk4/);
assert.match(generated.assembly, /function parseWideGraphRecordOrderedChunk0/);
assert.match(generated.assembly, /function parseWideGraphRecordOrderedChunk4/);
assert.equal(layout.bitmapWords, 5);
assert.equal(layout.nullOffset, 20);
assert.equal(layout.fieldOffset, 40);
assert.equal(layout.fields[32].offset, 296);
assert.equal(layout.fields[149].offset, 1232);
assert.equal(layout.lazyOffset, 1240);
assert.equal(layout.recordSize, 1264);

const { wasmPath } = await compilation.compile();

const schema = createSchemaRegistry(generated.layouts).get("Wide");
const binding = new RawNodeBinding(readFileSync(wasmPath), { scratchCapacity: 1 << 20, heapReserve: 1 << 20 });
const escapedSchema = createSchemaRegistry(generated.layouts).get("EscapedKey");
const escaped = binding.parse(escapedSchema, '{"a\\u0022b\\nc":9}');
assert.equal(escaped.value, 9, "escaped key spellings use the cold exact matcher");
assert.equal(binding.stringify(escapedSchema, escaped), '{"a\\"b\\nc":9}');
escaped.dispose();
const lexicalSchema = createSchemaRegistry(generated.layouts).get("Lexical");
const lexical = binding.parse(lexicalSchema, '{"n":1.0,"s":"\\u0061"}');
assert.equal(binding.stringify(lexicalSchema, lexical), '{"n":1,"s":"a"}', "stringify canonicalizes number and escape spellings");
lexical.dispose();
for (const lexicalSource of [
  '{"n":1,"s":"\\/"}',
  '{"n":1,"s":"\\u0022\\u005c"}',
  '{"n":1,"s":"\\b\\t\\n\\f\\r"}',
  '{"n":1,"s":"\\u0000\\u001f"}',
  '{"n":1,"s":"\\ud83d\\ude00"}',
  '{"n":1,"s":"\\ud800"}',
  '{"n":1,"s":"é世界"}',
]) {
  const lexicalView = binding.parse(lexicalSchema, lexicalSource);
  assert.equal(binding.stringify(lexicalSchema, lexicalView), JSON.stringify(JSON.parse(lexicalSource)));
  lexicalView.dispose();
}
const sourceObject = Object.fromEntries(fields.map((field, index) => [field.name, field.kind === "number" ? index + 0.25 : field.kind === "boolean" ? index % 2 === 0 : `value-${index}`]));
const source = JSON.stringify(sourceObject);
const view = binding.parse(schema, Buffer.from(source));
assert.equal(view.f0, 0.25);
assert.equal(view.f31, false);
assert.equal(view.f32, "value-32");

const record = view.__document + binding.u32[(view.__document + 12) >>> 2];
const lazyWord = () => binding.u32[(record + layout.lazyOffset + 4) >>> 2];
assert.equal((lazyWord() & 0x80000000) >>> 0, 0x80000000, "field 63 occupies the high bit of the second lazy word");
assert.equal(view.f63, 63.25);
assert.equal(lazyWord() & 0x80000000, 0, "reading field 63 clears the second lazy word");
assert.equal(view.f64, true);
assert.equal(view.f69, 69.25);
const lazyWord3 = () => binding.u32[(record + layout.lazyOffset + 12) >>> 2];
assert.equal((lazyWord3() & 0x80000000) >>> 0, 0x80000000, "field 127 occupies the high bit of the fourth lazy word");
assert.equal(view.f127, false);
assert.equal(lazyWord3() & 0x80000000, 0);
assert.equal(view.f149, "value-149");

view.f66 = -7.5;
sourceObject.f66 = -7.5;
assert.equal(binding.stringify(schema, view), JSON.stringify(sourceObject));
view.dispose();

const reversedSource = JSON.stringify(Object.fromEntries(Object.entries(sourceObject).reverse()));
const reversed = binding.parse(schema, reversedSource);
assert.equal(reversed.f0, 0.25, "wide chunk mismatch restarts the keyed tier");
assert.equal(reversed.f149, "value-149");
reversed.dispose();
assert.throws(() => binding.parse(schema, '{"f0":"bad"}'), SyntaxError, "fatal chunk value errors retain parser status");

const graphSchema = createSchemaRegistry(generated.layouts).get("WideGraph");
const graphObject = Object.fromEntries(graphFields.map((field, index) => [
  field.name,
  field.kind === "object" ? { value: 75.5 } : field.kind === "number" ? index + 0.25 : field.kind === "boolean" ? index % 2 === 0 : `value-${index}`,
]));
const graphView = binding.parse(graphSchema, Buffer.from(JSON.stringify(graphObject)));
assert.equal(graphView.f0, 0.25);
assert.equal(graphView.f75.value, 75.5);
assert.equal(graphView.f149, "value-149");
assert.equal(binding.stringify(graphSchema, graphView), JSON.stringify(graphObject));
graphView.dispose();

console.log("wide multiword schema: all tests passed");

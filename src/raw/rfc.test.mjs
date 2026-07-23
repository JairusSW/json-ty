import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RawNodeBinding } from "./node-binding.js";

const binding = new RawNodeBinding(readFileSync("build/raw/runtime.wasm"), {
  scratchCapacity: 1 << 20,
  heapReserve: 1 << 20,
});

// Curated JSONTestSuite/RFC 8259 shapes also exercised by json-as' RFC matrix.
const valid = ["null", "true", "false", "0", "-0", "1e-999", "1e999", "123.456789", "[]", "{}", "[1,2,3]", "[null,true,false]", '{"a":1,"a":2}', '{"":0}', '{"a":[{"b":"c"}]}', '""', '"\\"\\\\/\\b\\f\\n\\r\\t"', '"\\u20ac"', '"\\ud834\\udd1e"', '"\\ud800"', '"π"', " \n\r\t [ 1 ] ", "[5e-324,1.7976931348623157e308]"];

const invalid = ["", " ", "+1", ".1", "01", "-01", "1.", "1e", "1e+", "--1", "NaN", "Infinity", "nul", "True", "[1,]", "[,1]", "[1,,2]", "[1}", "{", "{]", "{'a':1}", "{a:1}", '{"a" 1}', '{"a":}', '{"a":1,}', '"', '"\\x20"', '"\\u12x4"', '"line\nfeed"', "[] trailing", "[1]#", "\ufeff[]", "[/*comment*/1]"];

for (const source of valid) {
  const expected = JSON.parse(source);
  const view = binding.parseDynamic(source);
  assert.deepEqual(view.toJS(), expected, source);
  view.dispose();
  const eager = binding.parseDynamic(new TextEncoder().encode(source), { eager: true });
  assert.deepEqual(eager.toJS(), expected, `eager: ${source}`);
  eager.dispose();
}
for (const source of invalid) {
  assert.throws(() => JSON.parse(source), undefined, `native fixture classification: ${source}`);
  assert.throws(() => binding.parseDynamic(source), SyntaxError, source);
}

for (const malformedUtf8 of [Uint8Array.of(0x22, 0xc0, 0xaf, 0x22), Uint8Array.of(0x22, 0xed, 0xa0, 0x80, 0x22), Uint8Array.of(0x22, 0xf4, 0x90, 0x80, 0x80, 0x22), Uint8Array.of(0x5b, 0xe2, 0x82, 0x5d)]) {
  assert.throws(() => binding.parseDynamic(malformedUtf8), SyntaxError);
  assert.throws(() => binding.parseDynamic(malformedUtf8, { eager: true }), SyntaxError);
  assert.throws(() => binding.parseDynamic(malformedUtf8, { plain: true }), SyntaxError);
}

console.log("raw RFC/JSONTestSuite matrix: all cases passed");

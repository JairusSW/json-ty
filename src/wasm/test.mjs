// Engine edge-case validation for the schema-directed parser.
import { registerSchema, parse, slotAt, readString, T } from "./runtime.js";

let fails = 0;
const eq = (n, g, w) => { if (g !== w) { console.log(`✗ ${n}: ${JSON.stringify(g)} want ${JSON.stringify(w)}`); fails++; } };

// scalars: number/int/bool/null + scientific
{
  const sid = registerSchema(["age", "verified", "deleted", "mid", "neg"]);
  const p = parse(sid, '{ "age":18, "verified":true, "deleted":false, "mid":null, "neg":-2.5e1 }');
  eq("age", slotAt(p, 0).number, 18);
  eq("verified", (slotAt(p, 1).off & 1) === 1, true);
  eq("deleted", (slotAt(p, 2).off & 1) === 1, false);
  eq("mid null", slotAt(p, 3).tag, T.NULL);
  eq("neg", slotAt(p, 4).number, -25);
}
// clean + escaped strings (ASCII slice path)
{
  const sid = registerSchema(["a", "b"]);
  const p = parse(sid, '{"a":"hello","b":"a\\"b\\nc"}');
  eq("clean tag", slotAt(p, 0).tag, T.STRING);
  eq("clean", readString(slotAt(p, 0)), "hello");
  eq("esc tag", slotAt(p, 1).tag, T.STRESC);
  eq("esc", readString(slotAt(p, 1)), 'a"b\nc');
}
// unicode doc (decode-from-WASM path) + escaped unicode
{
  const sid = registerSchema(["name", "s"]);
  const p = parse(sid, '{"name":"café €17 😀","s":"né\\"w 日"}');
  eq("uni", readString(slotAt(p, 0)), "café €17 😀");
  eq("uni esc", readString(slotAt(p, 1)), 'né"w 日');
}
// bytes input
{
  const sid = registerSchema(["k", "n"]);
  const p = parse(sid, new TextEncoder().encode('{"k":"hello","n":42}'));
  eq("bytes str", readString(slotAt(p, 0)), "hello");
  eq("bytes num", slotAt(p, 1).number, 42);
}

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails ? 1 : 0);

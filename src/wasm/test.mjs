// Validate the WASM parse engine end-to-end (hand-navigated tape).
import { parse, enter, regionCount, regionType, objKey, objSlotAt, arrSlotAt, decodeSlot, readString, T } from "./runtime.js";

let fails = 0;
const eq = (name, got, want) => { if (got !== want) { console.log(`✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); fails++; } };

// helper: read an object field's value by key from a region
function field(region, key) {
  for (let i = 0; i < regionCount(region); i++) {
    if (objKey(region, i) === key) return objSlotAt(region, i);
  }
  return undefined;
}

// --- Vec3: all eager scalars ---
{
  const r = parse('{"x":3.4,"y":1.2,"z":8.3}');
  eq("vec3 type", regionType(r), T.OBJECT);
  eq("vec3 count", regionCount(r), 3);
  eq("vec3.x", field(r, "x").number, 3.4);
  eq("vec3.y", field(r, "y").number, 1.2);
  eq("vec3.z", field(r, "z").number, 8.3);
}

// --- scalars: number/int/bool/null + lazy string ---
{
  const r = parse('{ "name":"Jairus", "age":18, "verified":true, "deleted":false, "mid":null, "neg":-2.5e1 }');
  eq("count", regionCount(r), 6);
  const name = field(r, "name");
  eq("name tag", name.tag, T.STRING);
  eq("name str", readString(name), "Jairus");
  eq("age", field(r, "age").number, 18);
  eq("verified", field(r, "verified").tag === T.BOOL && decodeBool(field(r, "verified")), true);
  eq("deleted", decodeBool(field(r, "deleted")), false);
  eq("mid null", field(r, "mid").tag, T.NULL);
  eq("neg", field(r, "neg").number, -25);
}
function decodeBool(slot) { // bool payload is in lo lane bit 0
  return slot.tag === T.BOOL ? (slot.off & 1) === 1 : undefined;
}

// --- escaped string ---
{
  const r = parse('{"s":"a\\"b\\nc"}');
  const s = field(r, "s");
  eq("esc tag", s.tag, T.STRESC);
  eq("esc str", readString(s), 'a"b\nc');
}

// --- nested object (lazy enter) ---
{
  const json = '{"first":"A","pos":{"x":1.5,"y":2.5,"z":3.5},"ok":true}';
  const r = parse(json);
  const pos = field(r, "pos");
  eq("pos tag", pos.tag, T.OBJECT);
  const child = enter(pos.off, pos.len);          // lazy: parse the nested object now
  eq("child type", regionType(child), T.OBJECT);
  eq("child.x", field(child, "x").number, 1.5);
  eq("child.z", field(child, "z").number, 3.5);
  eq("first still ok", readString(field(r, "first")), "A");  // re-read parent after enter
}

// --- array of numbers (eager) ---
{
  const r = parse('{"v":[3,9,2025]}');
  const v = field(r, "v");
  eq("arr tag", v.tag, T.ARRAY);
  const a = enter(v.off, v.len);
  eq("arr type", regionType(a), T.ARRAY);
  eq("arr count", regionCount(a), 3);
  eq("arr[0]", arrSlotAt(a, 0).number, 3);
  eq("arr[2]", arrSlotAt(a, 2).number, 2025);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);

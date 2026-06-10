// Hand-wired Player/Vec3 over the schema-tree engine. ONE parse() call links
// the nested Vec3; getters then navigate with zero WASM calls. Field access O(1).
import { registerSchema, parse, PRIM, LEAF } from "./runtime.js";
import { View } from "./view.js";

const VEC3 = registerSchema(["x", "y", "z"]); // all leaf
class Vec3View extends View {
  get x() { return this._num(0); }
  get y() { return this._num(1); }
  get z() { return this._num(2); }
}

// childSids: pos -> VEC3 (eager link), lastActive -> PRIM array, rest LEAF
const PLAYER = registerSchema(
  ["first name", "lastName", "lastActive", "age", "pos", "isVerified"],
  [LEAF, LEAF, PRIM, LEAF, VEC3, LEAF],
);
class PlayerView extends View {
  get firstName() { return this._str(0); }
  get lastName() { return this._str(1); }
  get lastActive() { return this._numArray(2); }
  get age() { return this._num(3); }
  get pos() { return this._child(4, Vec3View); }
  get isVerified() { return this._bool(5); }
}
const parsePlayer = (x) => new PlayerView(parse(PLAYER, x));

let fails = 0;
const eq = (n, g, w) => { if (JSON.stringify(g) !== JSON.stringify(w)) { console.log(`✗ ${n}: ${JSON.stringify(g)} != ${JSON.stringify(w)}`); fails++; } };

const json = '{"first name":"Jairus","lastName":"Tanaka","lastActive":[3,9,2025],"age":18,"pos":{"x":3.4,"y":1.2,"z":8.3},"isVerified":true}';
const p = parsePlayer(json);
eq("firstName", p.firstName, "Jairus");
eq("lastName", p.lastName, "Tanaka");
eq("lastActive", p.lastActive, [3, 9, 2025]);
eq("age", p.age, 18);
eq("pos.x", p.pos.x, 3.4);
eq("pos.z", p.pos.z, 8.3);
eq("isVerified", p.isVerified, true);
eq("pos memoized", p.pos === p.pos, true);

const p2 = parsePlayer('{"age":7,"extra":99,"isVerified":false,"first name":"Z","lastName":"Q","lastActive":[]}');
eq("ooo age", p2.age, 7);
eq("ooo first", p2.firstName, "Z");
eq("missing pos", p2.pos, undefined);
eq("empty arr", p2.lastActive, []);

const p3 = parsePlayer('{"first name":"A","lastName":"B","lastActive":[1],"age":20,"pos":null,"isVerified":false}');
eq("null pos", p3.pos, null);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails ? 1 : 0);

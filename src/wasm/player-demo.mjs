// Hand-wired Player/Vec3 views over the schema-directed engine. Field access is
// O(1) by compile-time index. This is the shape the transform will generate.
import { registerSchema, parseObject } from "./runtime.js";
import { View } from "./view.js";

// @json class Vec3 { x; y; z; }
const VEC3 = registerSchema(["x", "y", "z"]);
class Vec3View extends View {
  get x() { return this._num(0); }
  get y() { return this._num(1); }
  get z() { return this._num(2); }
}

// @json class Player {
//   @alias("first name") firstName; lastName; lastActive; age; pos; isVerified;
// }
const PLAYER = registerSchema(["first name", "lastName", "lastActive", "age", "pos", "isVerified"]);
class PlayerView extends View {
  get firstName() { return this._str(0); }
  get lastName() { return this._str(1); }
  get lastActive() { return this._numArray(2); }
  get age() { return this._num(3); }
  get pos() { return this._child(4, VEC3, Vec3View); }
  get isVerified() { return this._bool(5); }
}
const parsePlayer = (x) => new PlayerView(parseObject(PLAYER, x));

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

// out-of-order keys + extra key (ignored) + missing field
const p2 = parsePlayer('{"age":7,"extra":99,"isVerified":false,"first name":"Z","lastName":"Q","lastActive":[]}');
eq("ooo age", p2.age, 7);
eq("ooo first", p2.firstName, "Z");
eq("ooo verified", p2.isVerified, false);
eq("missing pos -> undefined", p2.pos, undefined);
eq("empty arr", p2.lastActive, []);

// null nested
const p3 = parsePlayer('{"first name":"A","lastName":"B","lastActive":[1],"age":20,"pos":null,"isVerified":false}');
eq("null pos", p3.pos, null);

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails ? 1 : 0);

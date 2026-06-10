// Hand-wired Player/Vec3 views — the shape the transform will generate for
// @json classes. Proves JSON.parse<Player>(input).firstName / .pos.x ergonomics.
import { parse } from "./runtime.js";
import { View } from "./view.js";

// @json class Vec3 { x: number; y: number; z: number; }
class Vec3View extends View {
  get x() { return this._num("x"); }
  get y() { return this._num("y"); }
  get z() { return this._num("z"); }
}

// @json class Player {
//   @alias("first name") firstName: string; lastName: string;
//   lastActive: number[]; age: int; pos: Vec3 | null; isVerified: boolean;
// }
class PlayerView extends View {
  get firstName() { return this._str("first name"); } // @alias
  get lastName() { return this._str("lastName"); }
  get lastActive() { return this._numArray("lastActive"); }
  get age() { return this._num("age"); }
  get pos() { return this._child("pos", Vec3View); }
  get isVerified() { return this._bool("isVerified"); }
}

// transform will emit: JSON.parse<Player>(x) -> new PlayerView(parse(x))
const parsePlayer = (input) => new PlayerView(parse(input));

// ---- prove it ----
let fails = 0;
const eq = (n, g, w) => { if (JSON.stringify(g) !== JSON.stringify(w)) { console.log(`✗ ${n}: ${JSON.stringify(g)} != ${JSON.stringify(w)}`); fails++; } };

const json = '{"first name":"Jairus","lastName":"Tanaka","lastActive":[3,9,2025],"age":18,"pos":{"x":3.4,"y":1.2,"z":8.3},"isVerified":true}';
const p = parsePlayer(json);

eq("firstName", p.firstName, "Jairus");
eq("lastName", p.lastName, "Tanaka");
eq("lastActive", p.lastActive, [3, 9, 2025]);
eq("age", p.age, 18);
eq("pos.x", p.pos.x, 3.4);
eq("pos.y", p.pos.y, 1.2);
eq("pos.z", p.pos.z, 8.3);
eq("isVerified", p.isVerified, true);
eq("pos.x memoized (same view)", p.pos === p.pos, true);

// null nested
const p2 = parsePlayer('{"first name":"A","lastName":"B","lastActive":[1],"age":20,"pos":null,"isVerified":false}');
eq("null pos", p2.pos, null);
eq("isVerified false", p2.isVerified, false);

// lazy: only touched fields materialize
console.log("\nlazy demo: parsePlayer() builds no JS strings until a getter is read.");
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
process.exit(fails ? 1 : 0);

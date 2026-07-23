/// <reference path="./index.d.ts" />
// Demos of json-ty working end-to-end. Compiled through the transform:
//   npx tsc src/playground.ts --outDir src ...   (see run below)
//   node dist/src/playground.js
import { JSON } from "./index.js";


@json
class Vec3 {
  x: number = 0;
  y: number = 0;
  z: number = 0;
}


@json
class Player {

  @alias("first name")
  firstName!: string;
  lastName!: string;
  lastActive!: number[];
  age!: int;
  pos!: Vec3 | null;
  isVerified!: boolean;
}

const playerJson = '{"first name":"Jairus","lastName":"Tanaka","lastActive":[3,9,2025],"age":18,"pos":{"x":3.4,"y":1.2,"z":8.3},"isVerified":true}';

console.log("=== lazy parse (WASM) ===");
const p = JSON.parse<Player>(playerJson);
console.log("firstName  ", p.firstName); // "Jairus"  (lazy string, sliced)
console.log("age        ", p.age); // 18        (eager scalar)
console.log("isVerified ", p.isVerified); // true
console.log("lastActive ", p.lastActive); // [3, 9, 2025]
console.log("pos.x      ", p.pos?.x); // 3.4       (nested view, zero extra calls)
console.log("pos.z      ", p.pos?.z); // 8.3
// console.log("JSON       ", JSON.stringify(p))
console.log("\n=== nullable nested ===");
const p2 = JSON.parse<Player>('{"first name":"A","lastName":"B","lastActive":[1],"age":20,"pos":null,"isVerified":false}');
console.log("pos        ", p2.pos); // null

console.log("\n=== top-level array<T> ===");
const vecs = JSON.parse<Vec3[]>('[{"x":1,"y":2,"z":3},{"x":4,"y":5,"z":6}]');
console.log("count      ", vecs.length); // 2
console.log("vecs[1].y  ", vecs[1].y); // 5

console.log("\n=== serialize (pure JS) ===");
const vec = JSON.from(Vec3, { x: 1.5, y: 2.5, z: 3.5 });
console.log("stringify  ", JSON.stringify<Vec3>(vec)); // {"x":1.5,"y":2.5,"z":3.5}

// --- @eager: parse into a flat buffer (full-deserialize / columnar mode) ---
@json({ eager: true })
class Metric {
  id!: int;
  value!: number;
  label!: string;
  ok!: boolean;
}

console.log("\n=== @eager parse (flat buffer) ===");
const m = JSON.parse<Metric>('{"id":7,"value":3.5,"label":"cpu","ok":true}');
console.log("id/value   ", m.id, m.value); // 7 3.5
console.log("label/ok   ", m.label, m.ok); // cpu true

const ms = JSON.parse<Metric[]>('[{"id":1,"value":10,"label":"a","ok":true},{"id":2,"value":20,"label":"b","ok":false}]');
console.log("eager arr  ", ms.length, ms[0].label, ms[1].value); // 2 a 20

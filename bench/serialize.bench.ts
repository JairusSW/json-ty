/// <reference path="../src/index.d.ts" />
import { bench, blackbox, dump, utf8ByteLength } from "./lib/bench.js";
// @ts-ignore — resolved at runtime from the flat build dir (see scripts/run-bench.sh)
import { JSON as JSONT } from "./index.js";
// @ts-ignore — resolved at runtime from the flat build dir
import { serializeString } from "./serialize/string.js";

@json
class Vec3 {
  x: number = 0;
  y: number = 0;
  z: number = 0;
}

@json
class Player {
  firstName!: string;
  lastName!: string;
  lastActive!: number[];
  age!: number;
  pos!: Vec3 | null;
  isVerified!: boolean;
}

@json
class NumBag {
  values!: number[];
}

@json
class VecBag {
  items!: Vec3[];
}

// ---- payloads -------------------------------------------------------------

const str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";

const vec = JSONT.from(Vec3, { x: 3.4, y: 1.2, z: 8.3 });

const player = JSONT.from(Player, {
  firstName: "Jairus",
  lastName: "Tanaka",
  lastActive: [3, 9, 2025],
  age: 18,
  pos: JSONT.from(Vec3, { x: 3.4, y: 1.2, z: 8.3 }),
  isVerified: true,
});

const nums = JSONT.from(NumBag, { values: [3, 9, 2025] });
const numsBig = JSONT.from(NumBag, { values: Array.from({ length: 64 }, (_, i) => i * 1.5) });
const vecs = JSONT.from(VecBag, { items: Array.from({ length: 8 }, () => JSONT.from(Vec3, { x: 3.4, y: 1.2, z: 8.3 })) });

// ---- correctness gate (don't bench a lie) ---------------------------------

function expectEqual(name: string, a: string, b: string): void {
  if (a !== b) {
    print(`  ✗ ${name} MISMATCH\n    native:  ${a}\n    json-ty: ${b}`);
    throw new Error("output mismatch for " + name);
  }
}
expectEqual("abc", JSON.stringify(str), serializeString(str));
expectEqual("vec3", JSON.stringify(vec), JSONT.stringify(vec));
expectEqual("player", JSON.stringify(player), JSONT.stringify(player));
expectEqual("nums", JSON.stringify(nums), JSONT.stringify(nums));
expectEqual("nums64", JSON.stringify(numsBig), JSONT.stringify(numsBig));
expectEqual("vecs", JSON.stringify(vecs), JSONT.stringify(vecs));
const playerNullPos = JSONT.from(Player, { firstName: "A", lastName: "B", lastActive: [1], age: 20, pos: null, isVerified: false });
expectEqual("player(null pos)", JSON.stringify(playerNullPos), JSONT.stringify(playerNullPos));

// ---- benches --------------------------------------------------------------

const ABC_OPS = 5_000_000;
const VEC_OPS = 5_000_000;
const PLAYER_OPS = 2_000_000;

const abcBytes = utf8ByteLength(JSON.stringify(str));
bench("native", "abc", () => { blackbox(JSON.stringify(blackbox(str))); }, ABC_OPS, abcBytes);
bench("json-ty", "abc", () => { blackbox(serializeString(blackbox(str))); }, ABC_OPS, abcBytes);

const vecBytes = utf8ByteLength(JSON.stringify(vec));
bench("native", "vec3", () => { blackbox(JSON.stringify(blackbox(vec))); }, VEC_OPS, vecBytes);
bench("json-ty", "vec3", () => { blackbox(JSONT.stringify(blackbox(vec))); }, VEC_OPS, vecBytes);
bench("json-ty (direct)", "vec3", () => { blackbox((Vec3 as any).__JSON_SERIALIZE(blackbox(vec))); }, VEC_OPS, vecBytes);

const playerBytes = utf8ByteLength(JSON.stringify(player));
bench("native", "player", () => { blackbox(JSON.stringify(blackbox(player))); }, PLAYER_OPS, playerBytes);
bench("json-ty", "player", () => { blackbox(JSONT.stringify(blackbox(player))); }, PLAYER_OPS, playerBytes);
bench("json-ty (direct)", "player", () => { blackbox((Player as any).__JSON_SERIALIZE(blackbox(player))); }, PLAYER_OPS, playerBytes);

const numsBytes = utf8ByteLength(JSON.stringify(nums));
bench("native", "nums", () => { blackbox(JSON.stringify(blackbox(nums))); }, VEC_OPS, numsBytes);
bench("json-ty", "nums", () => { blackbox(JSONT.stringify(blackbox(nums))); }, VEC_OPS, numsBytes);

const numsBigBytes = utf8ByteLength(JSON.stringify(numsBig));
bench("native", "nums64", () => { blackbox(JSON.stringify(blackbox(numsBig))); }, PLAYER_OPS, numsBigBytes);
bench("json-ty", "nums64", () => { blackbox(JSONT.stringify(blackbox(numsBig))); }, PLAYER_OPS, numsBigBytes);

const vecsBytes = utf8ByteLength(JSON.stringify(vecs));
bench("native", "vecs", () => { blackbox(JSON.stringify(blackbox(vecs))); }, PLAYER_OPS, vecsBytes);
bench("json-ty", "vecs", () => { blackbox(JSONT.stringify(blackbox(vecs))); }, PLAYER_OPS, vecsBytes);

dump("./build/logs/serialize.json");

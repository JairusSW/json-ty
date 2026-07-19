import { JSON as __JSON } from "./index.js";
import * as __JSON_METHODS from "./exports.js";
import { makeView as __JSONmakeView, parse as __JSONparse, parseStructArray as __JSONparseArrV, LEAF as __JSONLEAF, PRIM as __JSONPRIM } from "./wasm/runtime.js";
const __View_Vec3 = __JSONmakeView(["x", "y", "z"], [__JSONLEAF, __JSONLEAF, __JSONLEAF], { "x": ["num", 0], "y": ["num", 1], "z": ["num", 2] }, "Vec3");
const __View_Player = __JSONmakeView(["firstName", "lastName", "lastActive", "age", "pos", "isVerified"], [__JSONLEAF, __JSONLEAF, __JSONPRIM, __JSONLEAF, __View_Vec3.__sid, __JSONLEAF], { "firstName": ["str", 0], "lastName": ["str", 1], "lastActive": ["numArray", 2], "age": ["num", 3], "pos": ["child", 4, "Vec3"], "isVerified": ["bool", 5] }, "Player");
const __View_NumBag = __JSONmakeView(["values"], [__JSONPRIM], { "values": ["numArray", 0] }, "NumBag");
const __View_VecBag = __JSONmakeView(["items"], [__View_Vec3.__sid], { "items": ["structArray", 0, "Vec3"] }, "VecBag");
/// <reference path="../src/index.d.ts" />
import { bench, blackbox, dump, utf8ByteLength } from "./lib/bench.js";
// @ts-ignore — resolved at runtime from the flat build dir (see scripts/run-bench.sh)
import { JSON as JSONT } from "./index.js";
// @ts-ignore — resolved at runtime from the flat build dir
import { serializeString } from "./serialize/string.js";
class Vec3 {
    x = 0;
    y = 0;
    z = 0;
    static __JSON_INSTANTIATE() {
        const o = new Vec3();
        return o;
    }
    static __JSON_SERIALIZE(self) {
        return "{" + ("\"x\":" + __JSON_METHODS.serializeFloat(self.x)) + (",\"y\":" + __JSON_METHODS.serializeFloat(self.y)) + (",\"z\":" + __JSON_METHODS.serializeFloat(self.z)) + "}";
    }
    static __JSON_DESERIALIZE(data) {
        const obj = JSON.parse(data);
        const instance = new Vec3();
    }
}
class Player {
    firstName;
    lastName;
    lastActive;
    age;
    pos;
    isVerified;
    static __JSON_INSTANTIATE() {
        const o = new Player();
        return o;
    }
    static __JSON_SERIALIZE(self) {
        return "{" + ("\"firstName\":" + __JSON_METHODS.serializeString(self.firstName)) + (",\"lastName\":" + __JSON_METHODS.serializeString(self.lastName)) + (",\"lastActive\":" + __JSON_METHODS.serializeFloatArray(self.lastActive)) + (",\"age\":" + __JSON_METHODS.serializeFloat(self.age)) + (",\"pos\":" + __JSON.stringify(self.pos)) + (",\"isVerified\":" + __JSON_METHODS.serializeBool(self.isVerified)) + "}";
    }
    static __JSON_DESERIALIZE(data) {
        const obj = JSON.parse(data);
        const instance = new Player();
    }
}
class NumBag {
    values;
    static __JSON_INSTANTIATE() {
        const o = new NumBag();
        return o;
    }
    static __JSON_SERIALIZE(self) {
        return "{" + ("\"values\":" + __JSON_METHODS.serializeFloatArray(self.values)) + "}";
    }
    static __JSON_DESERIALIZE(data) {
        const obj = JSON.parse(data);
        const instance = new NumBag();
    }
}
class VecBag {
    items;
    static __JSON_INSTANTIATE() {
        const o = new VecBag();
        return o;
    }
    static __JSON_SERIALIZE(self) {
        return "{" + ("\"items\":" + __JSON_METHODS.serializeStructArray(self.items, Vec3)) + "}";
    }
    static __JSON_DESERIALIZE(data) {
        const obj = JSON.parse(data);
        const instance = new VecBag();
    }
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
function expectEqual(name, a, b) {
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
bench("json-ty (direct)", "vec3", () => { blackbox(Vec3.__JSON_SERIALIZE(blackbox(vec))); }, VEC_OPS, vecBytes);
const playerBytes = utf8ByteLength(JSON.stringify(player));
bench("native", "player", () => { blackbox(JSON.stringify(blackbox(player))); }, PLAYER_OPS, playerBytes);
bench("json-ty", "player", () => { blackbox(JSONT.stringify(blackbox(player))); }, PLAYER_OPS, playerBytes);
bench("json-ty (direct)", "player", () => { blackbox(Player.__JSON_SERIALIZE(blackbox(player))); }, PLAYER_OPS, playerBytes);
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

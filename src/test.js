import { JSON as __JSON } from "./index.js";
import * as __JSON_METHODS from "./exports.js";
import { makeView as __JSONmakeView, parse as __JSONparse, parseStructArray as __JSONparseArrV, LEAF as __JSONLEAF, PRIM as __JSONPRIM } from "./wasm/runtime.js";
const __View_Vec3 = __JSONmakeView(["x", "y", "z"], [__JSONLEAF, __JSONLEAF, __JSONLEAF], { "x": ["num", 0], "y": ["num", 1], "z": ["num", 2] }, "Vec3");
const __View_Player = __JSONmakeView(["firstName", "lastName", "lastActive", "age", "pos", "isVerified"], [__JSONLEAF, __JSONLEAF, __JSONPRIM, __JSONLEAF, __View_Vec3.__sid, __JSONLEAF], { "firstName": ["str", 0], "lastName": ["str", 1], "lastActive": ["numArray", 2], "age": ["num", 3], "pos": ["child", 4, "Vec3"], "isVerified": ["bool", 5] }, "Player");
const __View_NumBag = __JSONmakeView(["values"], [__JSONPRIM], { "values": ["numArray", 0] }, "NumBag");
const __View_VecBag = __JSONmakeView(["items"], [__View_Vec3.__sid], { "items": ["structArray", 0, "Vec3"] }, "VecBag");
const __View_Vec3 = __JSONmakeView(["x", "y", "z"], [__JSONLEAF, __JSONLEAF, __JSONLEAF], { "x": ["num", 0], "y": ["num", 1], "z": ["num", 2] }, "Vec3");
const __View_Player = __JSONmakeView(["firstName", "lastName", "lastActive", "age", "pos", "isVerified"], [__JSONLEAF, __JSONLEAF, __JSONPRIM, __JSONLEAF, __View_Vec3.__sid, __JSONLEAF], { "firstName": ["str", 0], "lastName": ["str", 1], "lastActive": ["numArray", 2], "age": ["num", 3], "pos": ["child", 4, "Vec3"], "isVerified": ["bool", 5] }, "Player");
const __View_Vec3 = __JSONmakeView(["x", "y", "z"], [__JSONLEAF, __JSONLEAF, __JSONLEAF], { "x": ["num", 0], "y": ["num", 1], "z": ["num", 2] }, "Vec3");
const __View_Player = __JSONmakeView(["first name", "lastName", "lastActive", "age", "pos", "isVerified"], [__JSONLEAF, __JSONLEAF, __JSONPRIM, __JSONLEAF, __View_Vec3.__sid, __JSONLEAF], { "firstName": ["str", 0], "lastName": ["str", 1], "lastActive": ["numArray", 2], "age": ["num", 3], "pos": ["child", 4, "Vec3"], "isVerified": ["bool", 5] }, "Player");
const __View_Vec3 = __JSONmakeView([], [], {}, "Vec3");
const __View_Player = __JSONmakeView(["first_name", "lastName", "lastActive", "age", "pos", "isVerified"], [__JSONLEAF, __JSONLEAF, __JSONPRIM, __JSONLEAF, __View_Vec3.__sid, __JSONLEAF], { "firstName": ["str", 0], "lastName": ["str", 1], "lastActive": ["numArray", 2], "age": ["num", 3], "pos": ["child", 4, "Vec3"], "isVerified": ["bool", 5] }, "Player");
import { JSON } from "./index.js";
const cache = new WeakMap();
const JSON_VERSION = Symbol("__JSON_META_VERSION");
class Vec3 {
    __JSON_x = 1.23;
    __JSON_y = 4.56;
    __JSON_z = 7.89;
    set x(value) {
        this[JSON_VERSION]++;
        this.__JSON_x = value;
    }
    get x() {
        return this.__JSON_x;
    }
    set y(value) {
        this[JSON_VERSION]++;
        this.__JSON_y = value;
    }
    get y() {
        return this.__JSON_y;
    }
    set z(value) {
        this[JSON_VERSION]++;
        this.__JSON_z = value;
    }
    get z() {
        return this.__JSON_z;
    }
    static __JSON_INSTANTIATE() {
        const o = new Vec3();
        return o;
    }
    static __JSON_SERIALIZE(self) {
        return "{" + "}";
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
        return "{" + ("\"first_name\":" + __JSON_METHODS.serializeString(self.firstName)) + (",\"lastName\":" + __JSON_METHODS.serializeString(self.lastName)) + (",\"lastActive\":" + __JSON_METHODS.serializeFloatArray(self.lastActive)) + ((!(self.age < 18) && ",\"age\":" + __JSON_METHODS.serializeFloat(self.age)) || "") + (",\"pos\":" + __JSON.stringify(self.pos)) + (",\"isVerified\":" + __JSON_METHODS.serializeBool(self.isVerified)) + "}";
    }
    static __JSON_DESERIALIZE(data) {
        const obj = JSON.parse(data);
        const instance = new Player();
    }
}
const v1 = JSON.from(Vec3, {
    x: 1.23,
    y: 4.56,
    z: 7.89
});
console.log("v1: " + JSON.stringify(v1));
const p1 = JSON.from(Player, {
    firstName: "Jairus",
    lastName: "Tanaka",
    age: 17,
    lastActive: [8, 30, 2025],
    pos: {
        x: 1.23,
        y: 4.56,
        z: 7.89
    },
    isVerified: true
});
console.log("p1: " + JSON.stringify(p1));

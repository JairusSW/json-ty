import { JSON as __JSON } from "./index.js";
import * as __JSON_METHODS from "./exports.js";
import { JSON } from "./index.js";
class Vec3 {
    x = 1.23;
    y = 4.56;
    z = 7.89;
    static __JSON_INSTANTIATE() {
        const o = new Vec3();
        return o;
    }
    static __JSON_SERIALIZE(self) {
        return "{" + ("\"x\":" + __JSON_METHODS.serializeFloat(self.x)) + (",\"y\":" + __JSON_METHODS.serializeInteger(self.y)) + (",\"z\":" + __JSON_METHODS.serializeFloat(self.z)) + "}";
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
        return "{" + ("\"first_name\":" + __JSON_METHODS.serializeString(self.firstName)) + (",\"lastName\":" + __JSON_METHODS.serializeString(self.lastName)) + (",\"lastActive\":" + __JSON_METHODS.serializeArray(self.lastActive)) + (",\"age\":" + __JSON_METHODS.serializeFloat(self.age)) + (",\"isVerified\":" + __JSON_METHODS.serializeBool(self.isVerified)) + "}";
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
    age: 18,
    lastActive: [8, 30, 2025],
    // pos: JSON.from(Vec3, {
    //   x: 1.23,
    //   y: 4.56,
    //   z: 7.89
    // }),
    isVerified: true
});
console.log("p1: " + JSON.stringify(p1));

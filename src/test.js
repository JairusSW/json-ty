var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { JSON as __JSON } from "./index.js";
import * as __JSON_METHODS from "./exports.js";
import { JSON } from "./index.js";
import { deserializeString } from "./deserialize/string.js";
import { serializeString } from "./serialize/string.js";
function alias(newName) {
    return () => { };
}
;
class Data {
    r = null;
    a = ["a", "b", "c"];
    b = true;
    s = "bob";
    n = 0.0;
    static __JSON_SERIALIZE(self) {
        return "{" + ("\"r\":" + __JSON.stringify(self.r)) + (",\"a\":" + __JSON_METHODS.serializeArray(self.a)) + (",\"b\":" + __JSON_METHODS.serializeBool(self.b)) + (",\"s\":" + __JSON_METHODS.serializeString(self.s)) + (",\"n\":" + __JSON_METHODS.serializeFloat(self.n)) + "}";
    }
}
__decorate([
    alias("r"),
    __metadata("design:type", Object)
], Data.prototype, "r", void 0);
const data = new Data();
data.r = new Data();
data.r.a = [];
data.r.b = false;
data.r.s = "";
if (data && typeof data.__JSON_SERIALIZE === "function") {
    console.log("Found method");
}
const ctor = data?.constructor;
if (ctor && typeof ctor.__JSON_SERIALIZE === "function") {
    console.log("Found static " + ctor.__JSON_SERIALIZE(data));
}
console.log(serializeString('hello" world'));
console.log(deserializeString("\"hello\\\" world\""));
// const serialized = JSON.stringify(vec);
// console.log("Serialized -> " + serialized);
// const desrialized = JSON.parse<Vec3>(serialized);
// console.log("Deserialized -> " + JSON.stringify(desrialized));
const testStrings = {
    "Paired Surrogate": "\uD83D\uDE00",
    "Unpaired High Surrogate": "\uD83D",
    "Unpaired Low Surrogate": "\uDE00",
    "Mixed Paired": "Hello \uD83D\uDE00 world",
    "Mixed Unpaired High": "Hello \uD83D world",
    "Mixed Unpaired Low": "Hello \uDE00 world",
    "Simple ASCII": "Hello World!",
    "Control chars": "Line1\nLine2\r\n\tTabbed",
    "Quotes and Backslash": 'He said "Hello" and \\ escaped',
};
function testSerializeString() {
    for (const [desc, str] of Object.entries(testStrings)) {
        const expected = JSON.stringify(str);
        const actual = serializeString(str);
        if (actual !== expected) {
            console.error(`Mismatch on "${desc}":\n  Expected: ${expected}\n  Actual:   ${actual}`);
        }
        else {
            console.log(`Passed: ${desc}`);
        }
    }
}
testSerializeString();

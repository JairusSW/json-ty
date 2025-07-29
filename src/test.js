import { JSON as __JSON } from "./index.js";
import * as __JSON_METHODS from "./exports.js";
import { JSON } from "./index.js";
import { deserializeString } from "./deserialize/string.js";
import { serializeString } from "./serialize/string.js";
class Data {
    b = true;
    s = "bob";
    n = 0.0;
    static __JSON_SERIALIZE(self) {
        return "{" + ("\"b\":" + __JSON_METHODS.serializeBool(self.b)) + (",\"s\":" + __JSON_METHODS.serializeString(self.s)) + (",\"n\":" + __JSON_METHODS.serializeFloat(self.n)) + "}";
    }
}
const data = new Data();
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

// import { JSON } from ".";
import { serializeString } from "./serialize/string";


// @json
// class Vec3 {
//   x: number = 0.0;
//   y: number = 0.0;
//   z: number = 0.0;
// }

// const vec: Vec3 = {
//   x: 3.4,
//   y: 1.2,
//   z: 5.8,
// };

console.log(serializeString("hello\" world"))
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
    } else {
      console.log(`Passed: ${desc}`);
    }
  }
}


testSerializeString()
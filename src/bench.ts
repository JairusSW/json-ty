import b from "benny";
import fastJson from "fast-json-stringify";
import { serializeString } from "./serialize/string.js";
import { serializeArray } from "./serialize/array.js";
import { serializeBool } from "./serialize/bool.js";
import { assert } from "console";
import { serializeFloat } from "./serialize/float.js";
import { deserializeString } from "./deserialize/string.js";
import { JSON as JSONT } from "./index.js";
import { serializeStruct } from "./serialize/struct.js";
import { serializeObject } from "./serialize/object.js";

function blackbox<T>(value: T): T {
  ; (globalThis as any).__blackbox ||= new Function("v", "return v");
  return (globalThis as any).__blackbox(value);
}

const str1 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
const str2 = '"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"';

@json
class Vec3 {
  x: number = 1.23;
  y: number = 4.56;
  z: number = 7.89;
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

const vec = { x: 3.4, y: 1.2, z: 8.3 };
const vec_cls = JSONT.from(Vec3, vec);

const player = {
  firstName: "Jairus",
  lastName: "Tanaka",
  lastActive: [3, 9, 2025],
  age: 18,
  pos: { x: 3.4, y: 1.2, z: 8.3 },
  isVerified: true,
};

const player_cls = JSONT.from(Player, {
  firstName: "Jairus",
  lastName: "Tanaka",
  lastActive: [3, 9, 2025],
  age: 18,
  pos: vec_cls,
  isVerified: true,
});

const vecArray = Array(10).fill(vec);

let dataBool = true;

assert(serializeString(str1) == JSON.stringify(str1))

const stringifyVec3Fast = fastJson({
  title: "Vec3",
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    z: { type: "number" },
  },
  required: ["x", "y", "z"],
});

const stringifyVec3ArrayFast = fastJson({
  type: "array",
  items: {
    type: "object",
    properties: {
      x: { type: "number" },
      y: { type: "number" },
      z: { type: "number" },
    },
    required: ["x", "y", "z"],
  },
});

const stringifyPlayerFast = fastJson({
  type: "object",
  properties: {
    firstName: { type: "string" },
    lastName: { type: "string" },
    lastActive: { type: "array", items: { type: "number" } },
    age: { type: "number" },
    pos: {
      anyOf: [
        {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          required: ["x", "y", "z"]
        },
        { type: "null" }
      ]
    },
    isVerified: { type: "boolean" }
  },
  required: ["firstName", "lastName", "lastActive", "age", "pos", "isVerified"],
});

console.log(stringifyVec3Fast.toString())
console.log(stringifyPlayerFast.toString())

const stringifyBoolFast = fastJson({ type: "boolean" });
const stringifyBoolArrayFast = fastJson({
  type: "array",
  items: { type: "boolean" },
});

let data2 = str1;

// function serializeVec3(obj: Vec3) {

//   // if (obj === null) return JSON_STR_EMPTY_OBJECT

//   let value
//   let json = "{"

//   value = obj["x"]
//   if (value !== undefined) {

//     json += "\"x\":"
//     json += serializeFloat(value)
//   } else {
//     throw new Error('"x" is required!')
//   }

//   value = obj["y"]
//   if (value !== undefined) {
//     json += ','
//     json += "\"y\":"
//     json += serializeFloat(value)
//   } else {
//     throw new Error('"y" is required!')
//   }

//   value = obj["z"]
//   if (value !== undefined) {
//     json += ','
//     json += "\"z\":"
//     json += serializeFloat(value)
//   } else {
//     throw new Error('"z" is required!')
//   }

//   return json + "}"

// }
(async () => {
  // await b.suite(
  //   "Serialize String",

  //   b.add("Native", () => {
  //     blackbox(JSON.stringify(blackbox(str1)));
  //   }),

  //   b.add("FJS", () => {
  //     blackbox(fastJson({ type: "string" })(blackbox(str1)));
  //   }),

  //   b.add("JSON-TS", () => {
  //     blackbox(serializeString(blackbox(str1)));
  //   }),

  //   b.cycle(),
  //   b.complete(),
  //   b.save({ file: "serialize.string", format: "chart.html" })
  // );


  // await b.suite(
  //   "Deserialize String",

  //   b.add("JSON-TS", () => {
  //     blackbox(deserializeString(blackbox(str2)));
  //   }),

  //   b.add("Native", () => {
  //     blackbox(JSON.stringify(blackbox(str2)));
  //   }),

  //   b.cycle(),
  //   b.complete(),
  //   b.save({ file: "deserialize.string", format: "chart.html" })
  // );

  await b.suite(
    "Serialize Vec3",

    b.add((vec.x = 3.4, "Native"), () => {
      blackbox(JSON.stringify(blackbox(vec)));
      vec.x++;
    }),

    b.add((vec.x = 3.4, "FJS"), () => {
      blackbox(stringifyVec3Fast(blackbox(vec)));
      vec.x++;
    }),

    b.add((vec.x = 3.4, "JSON-TS"), () => {
      // @ts-ignore
      blackbox(serializeObject<Vec3>(vec, Vec3));
      vec.x++
    }),

    b.cycle(),
    b.complete(),
    b.save({ file: "serialize.vec3", format: "chart.html" })
  );

  await b.suite(
    "Serialize Player",

    b.add("Native", () => {
      vec.x--;
      blackbox(JSON.stringify(blackbox(player)));
      vec.x++;
    }),

    b.add("FJS", () => {
      vec.x--;
      blackbox(stringifyPlayerFast(blackbox(player)));
      vec.x++;
    }),

    b.add("JSON-TS", () => {
      vec.x--;
      // @ts-ignore
      blackbox(JSON.stringify(blackbox(player_cls)));
      vec.x++;
    }),

    b.cycle(),
    b.complete(),
    b.save({ file: "serialize.player", format: "chart.html" })
  );

  // await b.suite(
  //   "Serialize Array",

  //   b.add("JSON-TS", () => {
  //     blackbox(serializeArray(blackbox(vecArray)));
  //     vecArray[0].x++;
  //   }),

  //   b.add("Native", () => {
  //     blackbox(JSON.stringify(blackbox(vecArray)));
  //     vecArray[0].x++;
  //   }),

  //   b.add("FJS", () => {
  //     blackbox(stringifyVec3ArrayFast(blackbox(vecArray)));
  //     vecArray[0].x++;
  //   }),

  //   b.cycle(),
  //   b.complete(),
  //   b.save({ file: "serialize.array", format: "chart.html" })
  // );

  // await b.suite(
  //   "Serialize Boolean",

  //   b.add("JSON-TS", () => {
  //     blackbox(serializeBool(blackbox(dataBool)));
  //     dataBool = !dataBool;
  //   }),

  //   b.add("Native", () => {
  //     blackbox(JSON.stringify(blackbox(dataBool)));
  //     dataBool = !dataBool;
  //   }),

  //   b.add("FJS", () => {
  //     blackbox(stringifyBoolFast(blackbox(dataBool)));
  //     dataBool = !dataBool;
  //   }),

  //   b.cycle(),
  //   b.complete(),
  //   b.save({ file: "serialize.bool", format: "chart.html" })
  // );
})();

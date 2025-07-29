import b from "benny";
import fastJson from "fast-json-stringify";
import { serializeString } from "./serialize/string.js";
import { serializeArray } from "./serialize/array.js";
import { serializeBool } from "./serialize/bool.js";
import { assert } from "console";
import { serializeFloat } from "./serialize/float.js";
import { deserializeString } from "./deserialize/string.js";

function blackbox<T>(value: T): T {
  ; (globalThis as any).__blackbox ||= new Function("v", "return v");
  return (globalThis as any).__blackbox(value);
}

const str1 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#$%^&*(){}[]:;"\'<>,./?~`';
const str2 = '"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#$%^&*(){}[]:;\\"\'<>,./?~`"'
const vec = { x: 1.23, y: 4.56, z: 7.89 };
const vecArray = Array(10).fill(vec);

let dataBool = true;

assert(serializeString(str1) == JSON.stringify(str1))

function serializeVec3(v: { x: number; y: number; z: number }): string {
  return `{"x":${serializeFloat(v.x)},"y":${serializeFloat(v.y)},"z":${serializeFloat(v.z)}}`;
}

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

const stringifyBoolFast = fastJson({ type: "boolean" });
const stringifyBoolArrayFast = fastJson({
  type: "array",
  items: { type: "boolean" },
});

let data2 = str1;

(async () => {
  // await b.suite(
  //   "Serialize String",

  //   b.add("JSON-TS", () => {
  //     blackbox(serializeString(blackbox(str1)));
  //   }),

  //   b.add("Native", () => {
  //     blackbox(JSON.stringify(blackbox(str1)));
  //   }),

  //   b.add("FJS", () => {
  //     blackbox(fastJson({ type: "string" })(blackbox(str1)));
  //   }),

  //   b.cycle(),
  //   b.complete(),
  //   b.save({ file: "serialize.string", format: "chart.html" })
  // );


  await b.suite(
    "Deserialize String",

    b.add("JSON-TS", () => {
      blackbox(deserializeString(blackbox(str2)));
    }),

    b.add("Native", () => {
      blackbox(JSON.stringify(blackbox(str2)));
    }),

    b.cycle(),
    b.complete(),
    b.save({ file: "deserialize.string", format: "chart.html" })
  );

  // await b.suite(
  //   "Serialize Vec3",

  //   b.add("JSON-TS", () => {
  //     vec.x--;
  //     blackbox(serializeVec3(blackbox(vec)));
  //     vec.x++;
  //   }),

  //   b.add("Native", () => {
  //     vec.x--;
  //     blackbox(JSON.stringify(blackbox(vec)));
  //     vec.x++;
  //   }),

  //   b.add("FJS", () => {
  //     vec.x--;
  //     blackbox(stringifyVec3Fast(blackbox(vec)));
  //     vec.x++;
  //   }),

  //   b.cycle(),
  //   b.complete(),
  //   b.save({ file: "serialize.vec3", format: "chart.html" })
  // );

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

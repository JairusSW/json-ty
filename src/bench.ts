import Benchmark from "benchmark";
import { serializeString } from "./serialize/string";
import fastJson from "fast-json-stringify";
import assert from "node:assert";

const data = 'abcdefghijklmnopqrstuvw"xyzABCDEFGHIJKLMNOP\uD83DQRSTUVWXYZ';
const vec = { x: 1.23, y: 4.56, z: 7.89 };

// assert.strictEqual(serializeString(data), JSON.stringify(data));

function serializeVec3(v: { x: number; y: number; z: number }) {
  return `{"x":${v.x},"y":${v.y},"z":${v.z}}`;
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

const suite = new Benchmark.Suite();

suite
  .add("Custom serializeString", function () {
    serializeString(data);
  })
  .add("JSON.stringify (string)", function () {
    JSON.stringify(data);
  })
  .add("fast-json-stringify (string)", function () {
    fastJson({ type: "string" })(data);
  })
  .add("Custom serializeVec3", function () {
    serializeVec3(vec);
  })
  .add("JSON.stringify (Vec3)", function () {
    JSON.stringify(vec);
  })
  .add("fast-json-stringify (Vec3)", function () {
    stringifyVec3Fast(vec);
  })
  .on("cycle", function (event: any) {
    console.log(String(event.target));
  })
  .on("complete", function () {
    console.log("Fastest is " + suite.filter("fastest").map("name"));
  })
  .run({ async: false });

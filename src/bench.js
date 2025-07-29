"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const benny_1 = __importDefault(require("benny"));
const fast_json_stringify_1 = __importDefault(require("fast-json-stringify"));
const string_js_1 = require("./serialize/string.js");
const console_1 = require("console");
const float_js_1 = require("./serialize/float.js");
const string_js_2 = require("./deserialize/string.js");
function blackbox(value) {
    ;
    globalThis.__blackbox ||= new Function("v", "return v");
    return globalThis.__blackbox(value);
}
const str1 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#$%^&*(){}[]:;"\'<>,./?~`';
const str2 = '"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#$%^&*(){}[]:;\\"\'<>,./?~`"';
const vec = { x: 1.23, y: 4.56, z: 7.89 };
const vecArray = Array(10).fill(vec);
let dataBool = true;
(0, console_1.assert)((0, string_js_1.serializeString)(str1) == JSON.stringify(str1));
function serializeVec3(v) {
    return `{"x":${(0, float_js_1.serializeFloat)(v.x)},"y":${(0, float_js_1.serializeFloat)(v.y)},"z":${(0, float_js_1.serializeFloat)(v.z)}}`;
}
const stringifyVec3Fast = (0, fast_json_stringify_1.default)({
    title: "Vec3",
    type: "object",
    properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
    },
    required: ["x", "y", "z"],
});
const stringifyVec3ArrayFast = (0, fast_json_stringify_1.default)({
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
const stringifyBoolFast = (0, fast_json_stringify_1.default)({ type: "boolean" });
const stringifyBoolArrayFast = (0, fast_json_stringify_1.default)({
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
    await benny_1.default.suite("Deserialize String", benny_1.default.add("JSON-TS", () => {
        blackbox((0, string_js_2.deserializeString)(blackbox(str2)));
    }), benny_1.default.add("Native", () => {
        blackbox(JSON.stringify(blackbox(str2)));
    }), benny_1.default.cycle(), benny_1.default.complete(), benny_1.default.save({ file: "deserialize.string", format: "chart.html" }));
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

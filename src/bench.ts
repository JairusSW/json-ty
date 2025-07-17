import Benchmark from "benchmark";
import { serializeString } from "./serialize/string";
import fastJson from "fast-json-stringify";
import assert from "node:assert";

const data = "abcdefghijklmnopqrstuvw\"xyzABCDEFGHIJKLMNOP\uD83DQRSTUVWXYZ";

assert(JSON.stringify(data) == serializeString(data))

const stringifyFast = fastJson({ type: "string" });

const suite = new Benchmark.Suite();

suite
  .add('Custom serializeString', function () {
    serializeString(data);
  })
  .add('JSON.stringify', function () {
    JSON.stringify(data);
  })
  .add('fast-json-stringify', function () {
    stringifyFast(data);
  })
  .on('cycle', function (event: any) {
    console.log(String(event.target));
  })
  .on('complete', function () {
    console.log('Fastest is ' + suite.filter('fastest').map('name'));
  })
  .run({ async: false });

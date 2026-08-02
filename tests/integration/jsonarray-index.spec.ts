import { JSON, json, alias, omit, omitnull, optional, lazy, eager, raw, omitif, codec, serializer, deserializer } from "json-ty";
import { describe, expect } from "./harness.js";

describe("JSON.Arr [] operator: read", () => {
  const a = JSON.parse<JSON.Arr>("[10,20,30]");
  // arr[i] returns a JSON.Value (like at(i))
  expect(a.at(0).get<f64>()).toBe(10.0);
  expect(a.at(1).get<f64>()).toBe(20.0);
  expect(a.at(2).get<f64>()).toBe(30.0);
});

describe("JSON.Arr [] operator: write", () => {
  const a = JSON.parse<JSON.Arr>("[10,20,30]");
  a.set(1, JSON.Value.from<i32>(99));
  expect(a.getAs<i32>(1)).toBe(99);
  expect(JSON.stringify(a)).toBe("[10,99,30]");
});

describe("JSON.Arr [] operator: build + index", () => {
  const a = new JSON.Arr();
  a.push<i32>(1);
  a.push<string>("two");
  a.set(0, JSON.Value.from<i32>(5));
  expect(a.at(0).get<i32>()).toBe(5);
  expect(a.at(1).get<string>()).toBe("two");
  expect(a.length).toBe(2);
});

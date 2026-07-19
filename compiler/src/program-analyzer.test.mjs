import assert from "node:assert/strict";
import { analyzeProgram, createProgramFromConfig } from "../lib/program-analyzer.js";

const program = createProgramFromConfig("compiler/fixtures/tsconfig.json");
const first = analyzeProgram(program).manifest;
const second = analyzeProgram(program).manifest;

assert.equal(first.version, 5);
assert.equal(first.hash, second.hash);
assert.deepEqual(
  first.schemas.map((schema) => schema.name),
  ["Box__number", "Cat", "CompositeDefaults", "Config", "Dog", "LazyAll", "LazyAuto", "LazyConvenience", "LazyConvenienceAll", "LazyConvenienceNone", "LazyNone", "numberArray", "numberJsonArray", "Player", "PlayerArray", "Position"],
);
const playerArray = first.schemas.find((schema) => schema.name === "PlayerArray");
assert.equal(playerArray.root, "array");
assert.equal(playerArray.fields[0].type.element.typeName, "Player");
const numberFacade = first.schemas.find((schema) => schema.name === "numberJsonArray");
assert.equal(numberFacade.root, "json-array");
assert.equal(numberFacade.fields[0].type.facade, "json-array");

const player = first.schemas.find((schema) => schema.name === "Player");
assert.ok(player);
assert.equal(player.fields.find((field) => field.name === "name")?.jsonName, "display name");
assert.equal(player.fields.find((field) => field.name === "score")?.optional, true);
assert.equal(player.fields.find((field) => field.name === "position")?.nullable, true);
assert.deepEqual(player.fields.find((field) => field.name === "samples")?.type, {
  kind: "array",
  element: { kind: "number" },
  facade: "array",
});
assert.equal(player.fields.find((field) => field.name === "active")?.hostManaged, true);
assert.equal(player.fields.find((field) => field.name === "active")?.defaultValue, true);
assert.equal(player.fields.find((field) => field.name === "age")?.decorators?.omitIf, "self.age < 18");
assert.deepEqual(player.fields.find((field) => field.name === "tuple")?.type?.elements, [{ kind: "number" }, { kind: "string" }, { kind: "boolean" }]);
const config = first.schemas.find((schema) => schema.name === "Config");
assert.equal(config.fields.find((field) => field.name === "role")?.kind, "number");
assert.equal(config.fields.find((field) => field.name === "defaultRole")?.defaultValue, 1);
assert.equal(config.fields.find((field) => field.name === "state")?.kind, "string");
assert.equal(config.fields.find((field) => field.name === "mode")?.kind, "string");
assert.deepEqual(config.fields.find((field) => field.name === "box")?.type, {
  kind: "object",
  typeName: "Box__number",
});
assert.deepEqual(config.fields.find((field) => field.name === "pet")?.type, {
  kind: "union",
  discriminator: "kind",
  variants: [
    { typeName: "Cat", discriminatorValue: "cat" },
    { typeName: "Dog", discriminatorValue: "dog" },
  ],
});
assert.equal(config.fields.find((field) => field.name === "hidden")?.decorators?.omitIf, "self.role === 0");
assert.deepEqual(config.fields.find((field) => field.name === "hidden")?.decorators?.omitIfPlan, {
  kind: "binary",
  operator: "==",
  left: { kind: "field", name: "role" },
  right: { kind: "literal", value: 0 },
});
const compositeDefaults = first.schemas.find((schema) => schema.name === "CompositeDefaults");
assert.deepEqual(compositeDefaults.fields.find((field) => field.name === "samples")?.defaultValue, [1, 2]);
assert.deepEqual(compositeDefaults.fields.find((field) => field.name === "position")?.defaultValue, { x: 3, y: 4 });
assert.deepEqual(compositeDefaults.fields.find((field) => field.name === "matrix")?.defaultValue, [[5], [6, 7]]);

const lazyAuto = first.schemas.find((schema) => schema.name === "LazyAuto");
assert.equal(lazyAuto.decorators.lazyMode, "auto");
assert.equal(lazyAuto.fields.find((field) => field.name === "id").decorators.lazy, false);
assert.equal(lazyAuto.fields.find((field) => field.name === "name").decorators.lazy, true);
assert.equal(lazyAuto.fields.find((field) => field.name === "position").decorators.lazy, false, "tiny scalar structs stay eager in auto mode");
assert.equal(lazyAuto.fields.find((field) => field.name === "samples").decorators.lazy, true);
assert.equal(lazyAuto.fields.find((field) => field.name === "forced").decorators.lazy, false);
const lazyAll = first.schemas.find((schema) => schema.name === "LazyAll");
assert.equal(lazyAll.fields.find((field) => field.name === "id").decorators.lazy, true);
assert.equal(lazyAll.fields.find((field) => field.name === "name").decorators.lazy, false);
const lazyNone = first.schemas.find((schema) => schema.name === "LazyNone");
assert.equal(lazyNone.fields.find((field) => field.name === "position").decorators.lazy, true);
assert.equal(lazyNone.fields.find((field) => field.name === "count").decorators.lazy, false);
assert.equal(lazyNone.fields.find((field) => field.name === "wrapped").decorators.lazy, true);
assert.equal(lazyNone.fields.find((field) => field.name === "nullableWrapped").decorators.lazy, true);
assert.equal(first.schemas.find((schema) => schema.name === "LazyConvenience").decorators.lazyMode, "auto");
assert.equal(first.schemas.find((schema) => schema.name === "LazyConvenienceAll").decorators.lazyMode, "all");
assert.equal(first.schemas.find((schema) => schema.name === "LazyConvenienceAll").fields[0].decorators.lazy, true);
assert.equal(first.schemas.find((schema) => schema.name === "LazyConvenienceNone").decorators.lazyMode, "none");
assert.equal(first.schemas.find((schema) => schema.name === "LazyConvenienceNone").fields[0].decorators.lazy, false);

const collisionProgram = createProgramFromConfig("compiler/fixtures/tsconfig.collision.json");
assert.throws(
  () => analyzeProgram(collisionProgram),
  /Schema name collision for Duplicate/,
  "ambiguous module-local class names must not silently share an ABI",
);

console.log("TypeScript schema analyzer: all tests passed");

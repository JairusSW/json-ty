import { mkdirSync, writeFileSync } from "node:fs";
import asc from "assemblyscript/asc";
import { generateAssemblyModule } from "../compiler/lib/index.js";

mkdirSync("build/raw", { recursive: true });

const generated = generateAssemblyModule([
  {
    name: "Metric",
    fields: [
      { name: "id", kind: "number" },
      { name: "value", kind: "number" },
      { name: "label", kind: "string" },
      { name: "ok", kind: "boolean" },
    ],
  },
  {
    name: "Vec3",
    fields: [
      { name: "x", kind: "number" },
      { name: "y", kind: "number" },
      { name: "z", kind: "number" },
    ],
  },
  {
    name: "Defaults",
    fields: [
      { name: "count", kind: "number", defaultValue: 7 },
      { name: "active", kind: "boolean", defaultValue: true },
      { name: "label", jsonName: "display label", kind: "string", defaultValue: 'a"x' },
      { name: "note", kind: "string", nullable: true, defaultValue: null, decorators: { omitNull: true } },
      { name: "secret", kind: "string", decorators: { omit: true } },
    ],
  },
  {
    name: "Position",
    fields: [
      { name: "x", kind: "number", defaultValue: 0 },
      { name: "y", kind: "number", defaultValue: 0 },
    ],
  },
  {
    name: "LazyChild",
    fields: [
      { name: "id", kind: "number" },
      { name: "label", kind: "string", decorators: { lazy: true } },
    ],
  },
  {
    name: "LazyRecord",
    fields: [
      { name: "id", kind: "number", decorators: { eager: true, lazy: false } },
      { name: "count", kind: "number", decorators: { lazy: true } },
      { name: "enabled", kind: "boolean", decorators: { lazy: true } },
      { name: "name", kind: "string", decorators: { lazy: true } },
      { name: "child", kind: "object", type: { kind: "object", typeName: "LazyChild" }, decorators: { lazy: true } },
      { name: "values", kind: "array", type: { kind: "array", element: { kind: "number" }, facade: "array" }, decorators: { lazy: true } },
      { name: "childEager", kind: "object", type: { kind: "object", typeName: "LazyChild" }, decorators: { eager: true, lazy: false } },
      { name: "nullable", kind: "object", type: { kind: "object", typeName: "LazyChild" }, nullable: true, decorators: { lazy: true } },
    ],
  },
  {
    name: "Player",
    fields: [
      { name: "name", kind: "string" },
      { name: "position", kind: "object", type: { kind: "object", typeName: "Position" }, nullable: true },
      { name: "samples", kind: "array", type: { kind: "array", element: { kind: "number" }, facade: "array" } },
      { name: "flags", kind: "array", type: { kind: "array", element: { kind: "boolean" }, facade: "array" } },
      { name: "tags", kind: "array", type: { kind: "array", element: { kind: "string" }, facade: "array" } },
      { name: "positions", kind: "array", type: { kind: "array", element: { kind: "object", typeName: "Position" }, facade: "array" } },
      { name: "matrix", kind: "array", type: { kind: "array", element: { kind: "array", element: { kind: "number" }, facade: "array" }, facade: "array" } },
      { name: "sampleView", kind: "array", type: { kind: "array", element: { kind: "number" }, facade: "json-array" } },
    ],
  },
  {
    name: "Tree",
    fields: [
      { name: "value", kind: "number" },
      { name: "children", kind: "array", type: { kind: "array", element: { kind: "object", typeName: "Tree" }, facade: "array" } },
    ],
  },
  {
    name: "TupleHolder",
    fields: [
      {
        name: "value",
        kind: "array",
        type: {
          kind: "array",
          element: { kind: "number" },
          elements: [{ kind: "number" }, { kind: "string" }, { kind: "boolean" }, { kind: "object", typeName: "Position" }],
          facade: "array",
        },
      },
    ],
  },
  {
    name: "Cat",
    fields: [
      { name: "kind", kind: "string" },
      { name: "lives", kind: "number" },
    ],
  },
  {
    name: "Dog",
    fields: [
      { name: "kind", kind: "string" },
      { name: "good", kind: "boolean" },
    ],
  },
  {
    name: "PetHolder",
    fields: [
      {
        name: "pet",
        kind: "union",
        type: {
          kind: "union",
          discriminator: "kind",
          variants: [
            { typeName: "Cat", discriminatorValue: "cat" },
            { typeName: "Dog", discriminatorValue: "dog" },
          ],
        },
      },
      {
        name: "pets",
        kind: "array",
        type: {
          kind: "array",
          element: {
            kind: "union",
            discriminator: "kind",
            variants: [
              { typeName: "Cat", discriminatorValue: "cat" },
              { typeName: "Dog", discriminatorValue: "dog" },
            ],
          },
          facade: "array",
        },
      },
    ],
  },
]);
const optimizeLevel = process.env.JSON_TY_OPTIMIZE_LEVEL ?? "3";
const simdArguments = process.env.JSON_TY_DISABLE_SIMD === "1" ? ["--disable", "simd"] : ["--enable", "simd"];
writeFileSync("build/raw/generated.ts", generated.assembly);
writeFileSync("build/raw/schema-layouts.json", JSON.stringify(generated.layouts, null, 2));

const { error, stderr } = await asc.main(["build/raw/generated.ts", "--outFile", "build/raw/runtime.wasm", "--textFile", "build/raw/runtime.wat", "--runtime", "stub", "--importMemory", "--zeroFilledMemory", ...simdArguments, "--enable", "bulk-memory", "--optimizeLevel", optimizeLevel, "--shrinkLevel", "0", "--noAssert"]);

if (error) {
  if (stderr) process.stderr.write(stderr.toString());
  throw error;
}

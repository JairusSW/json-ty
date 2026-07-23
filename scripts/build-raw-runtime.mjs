import { prepareArtifactCompilation } from "../dist/compiler/index.js";

const schemas = [
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
];
const compilation = prepareArtifactCompilation({
  schemas,
  directory: "build/raw",
  optimizeLevel: Number(process.env.JSON_TY_OPTIMIZE_LEVEL ?? "3"),
  kernelTier: process.env.JSON_TY_DISABLE_SIMD === "1"
    ? "swar"
    : (process.env.JSON_TY_KERNEL_TIER ?? "swar"),
});
await compilation.compile();

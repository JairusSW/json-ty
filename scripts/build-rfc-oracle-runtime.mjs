import { prepareArtifactCompilation } from "../dist/compiler/index.js";
import { relative, resolve } from "node:path";

const scalar = (kind) => ({ kind });
const array = (element) => ({ kind: "array", element, facade: "array" });
const field = (name, type, extra = {}) => ({ name, kind: type.kind, type, ...extra });

const schemas = [
  {
    name: "OracleObject",
    fields: [field("__jsonTyOracleSentinel", scalar("string"), { optional: true })],
  },
  {
    name: "OracleArrayObject",
    fields: [field("__jsonTyOracleSentinel", scalar("string"), { optional: true })],
  },
  { name: "OracleNumber", fields: [field("value", scalar("number"))] },
  { name: "OracleString", fields: [field("value", scalar("string"), { nullable: true })] },
  { name: "OracleBoolean", fields: [field("value", scalar("boolean"))] },
  {
    name: "OracleNumberArray",
    root: "array",
    fields: [field("value", array(scalar("number")))],
  },
  {
    name: "OracleStringArray",
    root: "array",
    fields: [field("value", array(scalar("string")))],
  },
  {
    name: "OracleBooleanArray",
    root: "array",
    fields: [field("value", array(scalar("boolean")))],
  },
  {
    name: "OracleObjectArray",
    root: "array",
    fields: [field("value", array({ kind: "object", typeName: "OracleArrayObject" }))],
  },
];

const kernelTier = process.env.JSON_TY_KERNEL_TIER ?? "naive";
const directory = resolve(`build/rfc-oracle/${kernelTier}`);
let runtimeImportBase = relative(directory, resolve("assembly")).replaceAll("\\", "/");
if (!runtimeImportBase.startsWith(".")) runtimeImportBase = `./${runtimeImportBase}`;
const compilation = prepareArtifactCompilation({
  schemas,
  directory,
  runtimeImportBase,
  kernelTier,
  optimizeLevel: Number(process.env.JSON_TY_OPTIMIZE_LEVEL ?? "3"),
});
await compilation.compile();
console.log(`> ${compilation.artifact.wasmPath}`);

import { mkdirSync, writeFileSync } from "node:fs";
import asc from "assemblyscript/asc";
import { generateAssemblyModule } from "../compiler/lib/index.js";
import { paritySchemas } from "../bench/parity/schemas.mjs";
import { lazyParitySchemas } from "../bench/parity/lazy-schemas.mjs";
import { classicSchemas } from "../bench/classic/schemas.mjs";

mkdirSync("build/parity", { recursive: true });
const generated = generateAssemblyModule([...paritySchemas, ...lazyParitySchemas, ...classicSchemas]);
const benchmarkSchemas = ["ParityVec3", "ParitySmall", "ParityMedium", "ParityLarge", "Canada", "PoemArray"];
const benchmarkAssembly = benchmarkSchemas
  .map(
    (name) => `
export function benchmarkParse${name}(source: u32, length: u32, iterations: u32): u32 {
  for (let index: u32 = 0; index < iterations; index++) {
    const document = parse${name}Trusted(source, length);
    if (document == 0 || releaseDocument(document) != 0) return 0;
  }
  return iterations;
}

export function benchmarkSerialize${name}(document: u32, output: u32, capacity: u32, iterations: u32): u32 {
  for (let index: u32 = 0; index < iterations; index++) {
    if (serialize${name}(document, output, capacity) != 0) return 0;
  }
  return iterations;
}
`,
  )
  .join("\n");
writeFileSync("build/parity/generated.ts", generated.assembly + benchmarkAssembly);
writeFileSync("build/parity/schema-layouts.json", JSON.stringify(generated.layouts, null, 2));

const simdArguments = process.env.JSON_TY_DISABLE_SIMD === "1" ? ["--disable", "simd"] : ["--enable", "simd"];
const { error, stderr } = await asc.main([
  "build/parity/generated.ts",
  "--outFile",
  "build/parity/runtime.wasm",
  "--textFile",
  "build/parity/runtime.wat",
  "--runtime",
  "stub",
  "--importMemory",
  "--zeroFilledMemory",
  ...simdArguments,
  "--enable",
  "bulk-memory",
  "--optimizeLevel",
  "3",
  "--shrinkLevel",
  "0",
  "--noAssert",
]);
if (error) {
  if (stderr) process.stderr.write(stderr.toString());
  throw error;
}
console.log("> build/parity/runtime.wasm");

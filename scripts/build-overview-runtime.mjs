import { mkdirSync, writeFileSync } from "node:fs";
import asc from "assemblyscript/asc";
import { generateAssemblyModule } from "../compiler/lib/index.js";
import { overviewSchemas } from "../bench/overview/schemas.mjs";

mkdirSync("build/overview", { recursive: true });

const generated = generateAssemblyModule(overviewSchemas);
writeFileSync("build/overview/generated.ts", generated.assembly);
writeFileSync("build/overview/schema-layouts.json", JSON.stringify(generated.layouts, null, 2));

const simdArguments = process.env.JSON_TY_DISABLE_SIMD === "1" ? ["--disable", "simd"] : ["--enable", "simd"];
const { error, stderr } = await asc.main(["build/overview/generated.ts", "--outFile", "build/overview/runtime.wasm", "--textFile", "build/overview/runtime.wat", "--runtime", "stub", "--importMemory", "--zeroFilledMemory", ...simdArguments, "--enable", "bulk-memory", "--optimizeLevel", process.env.JSON_TY_OPTIMIZE_LEVEL ?? "3", "--shrinkLevel", "0", "--noAssert"]);

if (error) {
  if (stderr) process.stderr.write(stderr.toString());
  throw error;
}

console.log("> build/overview/runtime.wasm");

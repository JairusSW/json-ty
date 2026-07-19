import { mkdirSync, writeFileSync } from "node:fs";
import asc from "assemblyscript/asc";
import { generateAssemblyModule } from "../compiler/lib/index.js";
import { classicSchemas } from "../bench/classic/schemas.mjs";

mkdirSync("build/classic", { recursive: true });

const generated = generateAssemblyModule(classicSchemas);
writeFileSync("build/classic/generated.ts", generated.assembly);
writeFileSync("build/classic/schema-layouts.json", JSON.stringify(generated.layouts, null, 2));

const simdArguments = process.env.JSON_TY_DISABLE_SIMD === "1" ? ["--disable", "simd"] : ["--enable", "simd"];
const { error, stderr } = await asc.main(["build/classic/generated.ts", "--outFile", "build/classic/runtime.wasm", "--textFile", "build/classic/runtime.wat", "--runtime", "stub", "--importMemory", "--zeroFilledMemory", ...simdArguments, "--enable", "bulk-memory", "--optimizeLevel", process.env.JSON_TY_OPTIMIZE_LEVEL ?? "3", "--shrinkLevel", "0", "--noAssert"]);

if (error) {
  if (stderr) process.stderr.write(stderr.toString());
  throw error;
}

console.log("> build/classic/runtime.wasm");

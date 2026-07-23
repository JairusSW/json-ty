import { prepareArtifactCompilation } from "../dist/compiler/index.js";
import { overviewSchemas } from "../bench/overview/schemas.mjs";

const compilation = prepareArtifactCompilation({
  schemas: overviewSchemas,
  directory: "build/overview",
  optimizeLevel: Number(process.env.JSON_TY_OPTIMIZE_LEVEL ?? "3"),
  kernelTier: process.env.JSON_TY_DISABLE_SIMD === "1"
    ? "swar"
    : (process.env.JSON_TY_KERNEL_TIER ?? "swar"),
});
await compilation.compile();

console.log("> build/overview/runtime.wasm");

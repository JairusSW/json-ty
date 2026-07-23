import { prepareArtifactCompilation } from "../dist/compiler/index.js";
import { paritySchemas } from "../bench/parity/schemas.mjs";
import { lazyParitySchemas } from "../bench/parity/lazy-schemas.mjs";
import { classicSchemas } from "../bench/classic/schemas.mjs";

const benchmarkSchemas = [
  "ParityVec3",
  "ParitySmall",
  "ParitySmallLazy",
  "ParityMedium",
  "ParityMediumLazy",
  "ParityLarge",
  "ParityLargeLazy",
  "Canada",
  "CanadaLazy",
  "PoemArray",
];
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

export function benchmarkParseInto${name}(source: u32, length: u32, output: u32, capacity: u32, iterations: u32): u32 {
  for (let index: u32 = 0; index < iterations; index++) {
    if (parse${name}IntoTrusted(source, length, output, capacity) != output) return 0;
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
  .join("\n") + `
export function benchmarkDocumentLifecycle(source: u32, length: u32, documentSize: u32, recordOffset: u32, recordSize: u32, mode: u32, iterations: u32): u32 {
  for (let index: u32 = 0; index < iterations; index++) {
    const allocated = allocateDocument(documentSize);
    if (allocated == 0) return 0;
    if (mode >= 1) memory.copy(<usize>allocated + 16, <usize>source, length);
    if (mode >= 2) memory.fill(<usize>allocated + recordOffset, 0, recordSize);
    if (releaseDocument(allocated) != 0) return 0;
  }
  return iterations;
}
`;
const compilation = prepareArtifactCompilation({
  schemas: [...paritySchemas, ...lazyParitySchemas, ...classicSchemas],
  directory: "build/parity",
  assemblySuffix: benchmarkAssembly,
  kernelTier: process.env.JSON_TY_DISABLE_SIMD === "1"
    ? "swar"
    : (process.env.JSON_TY_KERNEL_TIER ?? "simd"),
});
await compilation.compile();
console.log("> build/parity/runtime.wasm");

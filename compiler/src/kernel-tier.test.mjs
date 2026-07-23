import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  DEFAULT_KERNEL_TIER,
  KERNEL_TIERS,
  resolveKernelTier,
} from "../../dist/compiler/kernel-tier.js";
import { prepareArtifactCompilation } from "../../dist/compiler/artifact-compiler.js";

mkdirSync("build", { recursive: true });
const root = mkdtempSync(resolve("build/kernel-tier-test-"));
const schemas = [{
  name: "TierSmoke",
  fields: [
    { name: "id", kind: "number" },
    { name: "name", kind: "string" },
  ],
}];

assert.equal(DEFAULT_KERNEL_TIER, "swar");
assert.equal(resolveKernelTier(undefined), "swar");
assert.throws(() => resolveKernelTier("scalar"), /expected naive, swar, simd/);

const artifacts = [];
for (const kernelTier of KERNEL_TIERS) {
  const directory = resolve(root, kernelTier);
  let runtimeImportBase = relative(directory, resolve("assembly")).replaceAll("\\", "/");
  if (!runtimeImportBase.startsWith(".")) runtimeImportBase = `./${runtimeImportBase}`;
  const compilation = prepareArtifactCompilation({
    schemas,
    directory,
    runtimeImportBase,
    kernelTier,
  });
  const artifact = await compilation.compile();
  const metadata = JSON.parse(readFileSync(artifact.tierMetadataPath, "utf8"));
  assert.deepEqual(metadata, {
    kernelTier,
    selection: "compile-time",
    engine: "current",
  });
  assert.equal(artifact.kernelTier, kernelTier);
  artifacts.push(artifact);
}

const defaultDirectory = resolve(root, "default");
let defaultRuntimeImportBase = relative(defaultDirectory, resolve("assembly")).replaceAll("\\", "/");
if (!defaultRuntimeImportBase.startsWith(".")) defaultRuntimeImportBase = `./${defaultRuntimeImportBase}`;
const defaultArtifact = prepareArtifactCompilation({
  schemas,
  directory: defaultDirectory,
  runtimeImportBase: defaultRuntimeImportBase,
}).artifact;
assert.equal(defaultArtifact.kernelTier, "swar");

const identityDirectory = resolve(root, "identity");
let identityRuntimeImportBase = relative(identityDirectory, resolve("assembly")).replaceAll("\\", "/");
if (!identityRuntimeImportBase.startsWith(".")) identityRuntimeImportBase = `./${identityRuntimeImportBase}`;
const identityBase = prepareArtifactCompilation({
  schemas,
  directory: identityDirectory,
  runtimeImportBase: identityRuntimeImportBase,
});
const identitySuffix = prepareArtifactCompilation({
  schemas,
  directory: identityDirectory,
  runtimeImportBase: identityRuntimeImportBase,
  assemblySuffix: "\nexport function identityProbe(): i32 { return 1; }\n",
});
const identityOptimize = prepareArtifactCompilation({
  schemas,
  directory: identityDirectory,
  runtimeImportBase: identityRuntimeImportBase,
  optimizeLevel: 2,
});
assert.notEqual(identityBase.identity, identitySuffix.identity, "Assembly suffixes must invalidate artifact identity");
assert.notEqual(identityBase.identity, identityOptimize.identity, "compiler flags must invalidate artifact identity");

const alternateRuntime = resolve(root, "alternate-runtime");
mkdirSync(alternateRuntime, { recursive: true });
writeFileSync(resolve(alternateRuntime, "kernel.ts"), "export const value: i32 = 1;\n");
let alternateRuntimeImportBase = relative(identityDirectory, alternateRuntime).replaceAll("\\", "/");
if (!alternateRuntimeImportBase.startsWith(".")) alternateRuntimeImportBase = `./${alternateRuntimeImportBase}`;
const runtimeIdentityOne = prepareArtifactCompilation({
  schemas,
  directory: identityDirectory,
  runtimeImportBase: alternateRuntimeImportBase,
}).identity;
writeFileSync(resolve(alternateRuntime, "kernel.ts"), "export const value: i32 = 2;\n");
const runtimeIdentityTwo = prepareArtifactCompilation({
  schemas,
  directory: identityDirectory,
  runtimeImportBase: alternateRuntimeImportBase,
}).identity;
assert.notEqual(runtimeIdentityOne, runtimeIdentityTwo, "runtime kernel sources must invalidate artifact identity");
for (const path of [
  "assembly/deserialize/scanner.ts",
  "assembly/deserialize/number.ts",
  "assembly/serialize/string.ts",
  "assembly/util/scanValueEnd.ts",
]) {
  assert.doesNotMatch(readFileSync(path, "utf8"), /JSON_TY_KERNEL_TIER/, `${path} must delegate tier policy`);
}
assert.match(readFileSync("assembly/deserialize/kernel.ts", "utf8"), /JSON_TY_KERNEL_TIER/);
assert.match(readFileSync("assembly/serialize/kernel.ts", "utf8"), /JSON_TY_KERNEL_TIER/);

const [naive, swar, simd] = artifacts;
assert.deepEqual(readFileSync(naive.assemblyPath), readFileSync(swar.assemblyPath));
assert.deepEqual(readFileSync(swar.assemblyPath), readFileSync(simd.assemblyPath));
assert.notDeepEqual(
  readFileSync(naive.wasmPath),
  readFileSync(swar.wasmPath),
  "the naive artifact must compile the scalar oracle kernels",
);
assert.notDeepEqual(
  readFileSync(swar.wasmPath),
  readFileSync(simd.wasmPath),
  "the explicit SIMD artifact must compile the SIMD feature tier",
);

console.log("compile-time kernel tier contract: all tests passed");

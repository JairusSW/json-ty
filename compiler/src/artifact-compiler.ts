import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { generateAssemblyModule } from "./record-codegen/index.js";
import { resolveKernelTier, type KernelTier } from "./kernel-tier.js";
import type { ObjectLayout, ObjectSchema } from "./schema-ir.js";

export interface ArtifactCompilerOptions {
  schemas: ObjectSchema[];
  directory: string;
  runtimeImportBase?: string;
  assemblySuffix?: string;
  optimizeLevel?: 0 | 1 | 2 | 3;
  shrinkLevel?: 0 | 1 | 2;
  simd?: boolean;
  wasmCachePath?: string;
  /** Selects a kernel family at artifact generation time. Defaults to SWAR. */
  kernelTier?: KernelTier;
}

export interface AssemblyArtifact {
  directory: string;
  assemblyPath: string;
  layoutsPath: string;
  tierMetadataPath: string;
  wasmPath: string;
  watPath: string;
  layouts: ObjectLayout[];
  kernelTier: KernelTier;
}

export interface ArtifactCompilation {
  artifact: AssemblyArtifact;
  cacheHit: boolean;
  compile(): Promise<AssemblyArtifact>;
  compileSync(): AssemblyArtifact;
}

function writeIfChanged(path: string, contents: string): void {
  const bytes = Buffer.from(contents);
  if (existsSync(path) && readFileSync(path).equals(bytes)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function compileArguments(
  artifact: AssemblyArtifact,
  options: ArtifactCompilerOptions,
): string[] {
  const simd = options.simd ?? artifact.kernelTier === "simd";
  const tierConstant = artifact.kernelTier === "naive" ? 0 : artifact.kernelTier === "swar" ? 1 : 2;
  return [
    artifact.assemblyPath,
    "--outFile", artifact.wasmPath,
    "--textFile", artifact.watPath,
    "--runtime", "stub",
    "--importMemory",
    "--zeroFilledMemory",
    "--use", `JSON_TY_KERNEL_TIER=${tierConstant}`,
    simd ? "--enable" : "--disable", "simd",
    "--enable", "bulk-memory",
    "--optimizeLevel", String(options.optimizeLevel ?? 3),
    "--shrinkLevel", String(options.shrinkLevel ?? 0),
    "--noAssert",
  ];
}

function cacheArtifact(artifact: AssemblyArtifact, cachePath?: string): void {
  if (!cachePath) return;
  mkdirSync(dirname(cachePath), { recursive: true });
  copyFileSync(artifact.wasmPath, cachePath);
  copyFileSync(artifact.watPath, resolve(dirname(cachePath), "runtime.wat"));
}

/** Prepare one coherent generated-source, layout, Wasm, and WAT compilation. */
export function prepareArtifactCompilation(options: ArtifactCompilerOptions): ArtifactCompilation {
  const directory = resolve(options.directory);
  const kernelTier = resolveKernelTier(options.kernelTier);
  mkdirSync(directory, { recursive: true });
  const generated = generateAssemblyModule(options.schemas, {
    runtimeImportBase: options.runtimeImportBase,
  });
  const artifact: AssemblyArtifact = {
    directory,
    assemblyPath: resolve(directory, "generated.ts"),
    layoutsPath: resolve(directory, "schema-layouts.json"),
    tierMetadataPath: resolve(directory, "kernel-tier.json"),
    wasmPath: resolve(directory, "runtime.wasm"),
    watPath: resolve(directory, "runtime.wat"),
    layouts: generated.layouts,
    kernelTier,
  };
  writeIfChanged(artifact.assemblyPath, generated.assembly + (options.assemblySuffix ?? ""));
  writeIfChanged(artifact.layoutsPath, `${JSON.stringify(generated.layouts, null, 2)}\n`);
  writeIfChanged(artifact.tierMetadataPath, `${JSON.stringify({
    kernelTier,
    selection: "compile-time",
    engine: "current",
  }, null, 2)}\n`);

  const cachedWatPath = options.wasmCachePath === undefined
    ? undefined
    : resolve(dirname(options.wasmCachePath), "runtime.wat");
  const cacheHit = options.wasmCachePath !== undefined && cachedWatPath !== undefined
    && existsSync(options.wasmCachePath) && existsSync(cachedWatPath);
  if (cacheHit) {
    copyFileSync(options.wasmCachePath!, artifact.wasmPath);
    copyFileSync(cachedWatPath!, artifact.watPath);
  }
  const arguments_ = compileArguments(artifact, options);
  let compiled = cacheHit;

  return {
    artifact,
    cacheHit,
    async compile() {
      if (compiled) return artifact;
      const { default: asc } = await import("assemblyscript/asc");
      const { error, stderr } = await asc.main(arguments_);
      if (error) throw new Error(stderr?.toString() || String(error));
      cacheArtifact(artifact, options.wasmCachePath);
      compiled = true;
      return artifact;
    },
    compileSync() {
      if (compiled) return artifact;
      const require = createRequire(import.meta.url);
      const ascPath = require.resolve("assemblyscript/bin/asc.js");
      const result = spawnSync(process.execPath, [ascPath, ...arguments_], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        const detail = result.stderr || result.stdout || `asc exited with status ${result.status}`;
        throw new Error(detail.trim());
      }
      cacheArtifact(artifact, options.wasmCachePath);
      compiled = true;
      return artifact;
    },
  };
}

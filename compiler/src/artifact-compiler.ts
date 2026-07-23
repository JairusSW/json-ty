import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
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
  cacheDirectory?: string;
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
  /** Content identity of every input that can affect the emitted Wasm. */
  identity: string;
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

function runtimeSourceIdentity(directory: string): string {
  const hash = createHash("sha256");
  const visit = (current: string): void => {
    if (!existsSync(current) || !statSync(current).isDirectory()) return;
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === "__tests__" || entry.name === "wasm") continue;
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        hash.update(relative(directory, path).replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(readFileSync(path));
        hash.update("\0");
      }
    }
  };
  visit(directory);
  return hash.digest("hex");
}

function assemblyScriptVersion(): string {
  const require = createRequire(import.meta.url);
  return require("assemblyscript/package.json").version as string;
}

function compilationIdentity(
  assembly: string,
  layouts: ObjectLayout[],
  arguments_: string[],
  runtimeDirectory: string,
): string {
  return createHash("sha256")
    .update(assembly)
    .update("\0")
    .update(JSON.stringify(layouts))
    .update("\0")
    .update(JSON.stringify(arguments_.slice(1)))
    .update("\0")
    .update(assemblyScriptVersion())
    .update("\0")
    .update(runtimeSourceIdentity(runtimeDirectory))
    .digest("hex");
}

function cacheArtifact(artifact: AssemblyArtifact, cacheEntry?: string): void {
  if (!cacheEntry) return;
  mkdirSync(cacheEntry, { recursive: true });
  copyFileSync(artifact.wasmPath, resolve(cacheEntry, "runtime.wasm"));
  copyFileSync(artifact.watPath, resolve(cacheEntry, "runtime.wat"));
}

/** Prepare one coherent generated-source, layout, Wasm, and WAT compilation. */
export function prepareArtifactCompilation(options: ArtifactCompilerOptions): ArtifactCompilation {
  const directory = resolve(options.directory);
  const kernelTier = resolveKernelTier(options.kernelTier);
  mkdirSync(directory, { recursive: true });
  const generated = generateAssemblyModule(options.schemas, {
    runtimeImportBase: options.runtimeImportBase,
  });
  const assembly = generated.assembly + (options.assemblySuffix ?? "");
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
  writeIfChanged(artifact.assemblyPath, assembly);
  writeIfChanged(artifact.layoutsPath, `${JSON.stringify(generated.layouts, null, 2)}\n`);
  writeIfChanged(artifact.tierMetadataPath, `${JSON.stringify({
    kernelTier,
    selection: "compile-time",
    engine: "current",
  }, null, 2)}\n`);

  const arguments_ = compileArguments(artifact, options);
  const runtimeDirectory = resolve(directory, options.runtimeImportBase ?? "../../assembly");
  const identity = compilationIdentity(assembly, generated.layouts, arguments_, runtimeDirectory);
  const cacheEntry = options.cacheDirectory === undefined
    ? undefined
    : resolve(options.cacheDirectory, identity);
  const cachedWasmPath = cacheEntry === undefined ? undefined : resolve(cacheEntry, "runtime.wasm");
  const cachedWatPath = cacheEntry === undefined ? undefined : resolve(cacheEntry, "runtime.wat");
  const cacheHit = cachedWasmPath !== undefined && cachedWatPath !== undefined
    && existsSync(cachedWasmPath) && existsSync(cachedWatPath);
  if (cacheHit) {
    copyFileSync(cachedWasmPath!, artifact.wasmPath);
    copyFileSync(cachedWatPath!, artifact.watPath);
  }
  let compiled = cacheHit;

  return {
    artifact,
    identity,
    cacheHit,
    async compile() {
      if (compiled) return artifact;
      const { default: asc } = await import("assemblyscript/asc");
      const { error, stderr } = await asc.main(arguments_);
      if (error) throw new Error(stderr?.toString() || String(error));
      cacheArtifact(artifact, cacheEntry);
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
      cacheArtifact(artifact, cacheEntry);
      compiled = true;
      return artifact;
    },
  };
}

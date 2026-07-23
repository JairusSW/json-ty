import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { prepareArtifactCompilation, type ArtifactCompilation } from "./artifact-compiler.js";
import { resolveKernelTier, type KernelTier } from "./kernel-tier.js";
import { createJsonTyTransformer } from "./call-transformer.js";
import { generateHostArtifact } from "./host-artifact/index.js";
import { analyzeProgram, createProgramFromConfig } from "./program-analyzer.js";

// Bump whenever emitted AssemblyScript or host bindings change, independently
// of the schema-IR version, so an existing project never reuses stale Wasm.
const CODEGEN_VERSION = 10;

export interface BuildProjectOptions {
  configPath: string;
  generatedDirectory?: string;
  cacheDirectory?: string;
  packageRoot?: string;
  emitTypeScript?: boolean;
  runtimeModuleSpecifier?: string;
  optimizeLevel?: 0 | 1 | 2 | 3;
  shrinkLevel?: 0 | 1 | 2;
  kernelTier?: KernelTier;
}

export type GenerateProjectOptions = Omit<
  BuildProjectOptions,
  "configPath" | "emitTypeScript" | "runtimeModuleSpecifier"
>;

export interface BuildProjectResult {
  hash: string;
  cacheHit: boolean;
  generatedDirectory: string;
  manifestPath: string;
  layoutsPath: string;
  tierMetadataPath: string;
  assemblyPath: string;
  wasmPath: string;
  runtimePath: string;
  kernelTier: KernelTier;
  emitDiagnostics: readonly ts.Diagnostic[];
}

export interface GeneratedProjectResult
  extends Omit<BuildProjectResult, "emitDiagnostics"> {
  schemaBindings: Readonly<Record<string, { parse: string; stringify: string }>>;
}

interface PreparedProject extends GeneratedProjectResult {
  compilation: ArtifactCompilation;
}

function writeIfChanged(path: string, contents: string | Uint8Array): void {
  const previous = existsSync(path) ? readFileSync(path) : undefined;
  const bytes = typeof contents === "string" ? Buffer.from(contents) : Buffer.from(contents);
  if (previous?.equals(bytes)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function modulePath(fromDirectory: string, targetPath: string): string {
  let path = relative(fromDirectory, targetPath).split(sep).join("/");
  if (!path.startsWith(".")) path = `./${path}`;
  return path;
}

function commonSourceDirectory(program: ts.Program): string {
  const files = program.getSourceFiles().filter((file) =>
    !file.isDeclarationFile && !program.isSourceFileFromExternalLibrary(file));
  let common = files.length === 0 ? ts.sys.getCurrentDirectory() : dirname(resolve(files[0]!.fileName));
  for (const file of files.slice(1)) {
    const directory = dirname(resolve(file.fileName));
    while (common !== dirname(common)) {
      const path = relative(common, directory);
      if (path !== ".." && !path.startsWith(`..${sep}`)) break;
      common = dirname(common);
    }
  }
  return common;
}

function emittedSourceDirectory(program: ts.Program, sourceFile: ts.SourceFile): string {
  const compilerOptions = program.getCompilerOptions();
  if (!compilerOptions.outDir) return dirname(sourceFile.fileName);
  const sourceRoot = compilerOptions.rootDir
    ? resolve(compilerOptions.rootDir)
    : commonSourceDirectory(program);
  return dirname(resolve(compilerOptions.outDir, relative(sourceRoot, sourceFile.fileName)));
}

function prepareProject(
  program: ts.Program,
  options: GenerateProjectOptions = {},
): PreparedProject {
  const packageRoot = resolve(options.packageRoot ?? dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
  const generatedDirectory = resolve(options.generatedDirectory ?? ".json-ty");
  const cacheDirectory = resolve(options.cacheDirectory ?? resolve(generatedDirectory, "cache"));
  mkdirSync(generatedDirectory, { recursive: true });
  mkdirSync(cacheDirectory, { recursive: true });

  const analysis = analyzeProgram(program);
  const optimizeLevel = options.optimizeLevel ?? 3;
  const shrinkLevel = options.shrinkLevel ?? 0;
  const kernelTier = resolveKernelTier(options.kernelTier);
  const hash = createHash("sha256").update(analysis.manifest.hash).update(`|codegen:${CODEGEN_VERSION}|as:0.28|O:${optimizeLevel}|z:${shrinkLevel}|tier:${kernelTier}|simd|bulk-memory|stub`).digest("hex");
  const cacheEntry = resolve(cacheDirectory, hash);
  const cachedWasm = resolve(cacheEntry, "runtime.wasm");
  const manifestPath = resolve(generatedDirectory, "schema-manifest.json");
  const runtimePath = resolve(generatedDirectory, "runtime.js");
  const assemblyBase = modulePath(generatedDirectory, resolve(packageRoot, "assembly"));
  const compilation = prepareArtifactCompilation({
    schemas: analysis.manifest.schemas,
    directory: generatedDirectory,
    runtimeImportBase: assemblyBase,
    optimizeLevel,
    shrinkLevel,
    kernelTier,
    wasmCachePath: cachedWasm,
  });
  const hostArtifact = generateHostArtifact(compilation.artifact.layouts);

  writeIfChanged(manifestPath, `${JSON.stringify(analysis.manifest, null, 2)}\n`);
  writeIfChanged(runtimePath, hostArtifact.source);

  return {
    hash,
    cacheHit: compilation.cacheHit,
    generatedDirectory,
    manifestPath,
    layoutsPath: compilation.artifact.layoutsPath,
    tierMetadataPath: compilation.artifact.tierMetadataPath,
    assemblyPath: compilation.artifact.assemblyPath,
    wasmPath: compilation.artifact.wasmPath,
    runtimePath,
    kernelTier,
    schemaBindings: hostArtifact.schemaBindings,
    compilation,
  };
}

export function createGeneratedProjectTransformer(
  program: ts.Program,
  generated: GeneratedProjectResult,
  runtimeModuleSpecifier?: string,
): ts.TransformerFactory<ts.SourceFile> {
  return createJsonTyTransformer(program, {
    runtimeModule: runtimeModuleSpecifier ?? ((sourceFile) =>
      modulePath(emittedSourceDirectory(program, sourceFile), generated.runtimePath)),
    schemaBindings: generated.schemaBindings,
  });
}

/**
 * Generate and compile application-specific artifacts during a synchronous
 * TypeScript transform hook. Cache hits do not start an AssemblyScript process.
 */
export function generateProjectSync(
  program: ts.Program,
  options: GenerateProjectOptions = {},
): GeneratedProjectResult {
  const prepared = prepareProject(program, options);
  prepared.compilation.compileSync();
  return prepared;
}

export async function buildProject(options: BuildProjectOptions): Promise<BuildProjectResult> {
  const program = createProgramFromConfig(options.configPath);
  const preEmit = ts.getPreEmitDiagnostics(program);
  const errors = preEmit.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length !== 0) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(errors, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => ts.sys.newLine,
      }),
    );
  }

  const prepared = prepareProject(program, options);
  await prepared.compilation.compile();

  let emitDiagnostics: readonly ts.Diagnostic[] = [];
  if (options.emitTypeScript ?? true) {
    const emit = program.emit(undefined, undefined, undefined, undefined, {
      before: [createGeneratedProjectTransformer(program, prepared, options.runtimeModuleSpecifier)],
    });
    emitDiagnostics = emit.diagnostics;
  }

  return {
    hash: prepared.hash,
    cacheHit: prepared.cacheHit,
    generatedDirectory: prepared.generatedDirectory,
    manifestPath: prepared.manifestPath,
    layoutsPath: prepared.layoutsPath,
    tierMetadataPath: prepared.tierMetadataPath,
    assemblyPath: prepared.assemblyPath,
    wasmPath: prepared.wasmPath,
    runtimePath: prepared.runtimePath,
    kernelTier: prepared.kernelTier,
    emitDiagnostics,
  };
}

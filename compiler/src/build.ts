import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { generateAssemblyModule } from "./assembly-codegen.js";
import { createJsonTyTransformer } from "./call-transformer.js";
import { generateHostViewSource } from "./host-codegen.js";
import { analyzeProgram, createProgramFromConfig } from "./program-analyzer.js";

// Bump whenever emitted AssemblyScript or host bindings change, independently
// of the schema-IR version, so an existing project never reuses stale Wasm.
const CODEGEN_VERSION = 6;

export interface BuildProjectOptions {
  configPath: string;
  generatedDirectory?: string;
  cacheDirectory?: string;
  packageRoot?: string;
  emitTypeScript?: boolean;
  runtimeModuleSpecifier?: string;
  optimizeLevel?: 0 | 1 | 2 | 3;
  shrinkLevel?: 0 | 1 | 2;
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
  assemblyPath: string;
  wasmPath: string;
  runtimePath: string;
  emitDiagnostics: readonly ts.Diagnostic[];
}

export interface GeneratedProjectResult
  extends Omit<BuildProjectResult, "emitDiagnostics"> {
  schemaBindings: Readonly<Record<string, { parse: string; stringify: string }>>;
}

interface PreparedProject extends GeneratedProjectResult {
  cacheEntry: string;
  cachedWasm: string;
  compileArguments: string[];
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

function generatedRuntimeSource(layouts: ReturnType<typeof generateAssemblyModule>["layouts"]): string {
  const schemaDeclarations = layouts.map((layout, index) => `const schema${index} = schemas.get(${JSON.stringify(layout.name)});`).join("\n");
  const schemaBindings = layouts
    .map((layout, index) => {
      const schemaVariable = `schema${index}`;
      const targetExpression = layout.root ? `${schemaVariable}._registry.get(${JSON.stringify(layout.fields[0]?.type && layout.fields[0].type.kind === "array" && layout.fields[0].type.element.kind === "object" ? layout.fields[0].type.element.typeName : "")})` : schemaVariable;
      return `binding._parsers.set(${JSON.stringify(layout.name)}, binding.exports.${layout.abi!.parse});
binding._parsers.set(${JSON.stringify(`${layout.name}:strict`)}, binding.exports.${layout.abi!.parse});
binding._parsers.set(${JSON.stringify(`${layout.name}:trusted`)}, binding.exports.${layout.abi!.parseTrusted});
binding._serializers.set(${JSON.stringify(layout.name)}, binding.exports.${layout.abi!.serialize});
${layout.abi!.materialize ? `binding._materializers.set(${JSON.stringify(layout.name)}, binding.exports.${layout.abi!.materialize});` : ""}
export const ${layout.abi!.parse} = (input, constructor) => {
  const target = ${targetExpression};
  if (constructor && target && target.Class !== constructor) bindSchemaClass(target, constructor);
  return binding.parse(${schemaVariable}, input);
};
export const ${layout.abi!.serialize} = (value) => binding.stringify(${schemaVariable}, value);
__jsonTyRuntime.${`parse${layout.name}`} = ${layout.abi!.parse};
__jsonTyRuntime.${`stringify${layout.name}`} = ${layout.abi!.serialize};`;
    })
    .join("\n");
  const hostViews = generateHostViewSource(layouts);
  return `import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  RAW_ASCII_SOURCE,
  RAW_OVERLAY,
  RAW_ROOT,
  RAW_RUNTIME,
  RAW_STATE,
  GeneratedViewBase,
  RawNodeBinding,
  activeDocument,
  bindSchemaClass,
  createSchemaRegistry,
  decodeStringRef,
  disposeGeneratedView,
  generatedViewDocument,
  invalidateGeneratedView,
  readGeneratedComposite,
  syncGeneratedEnumerable,
  writeGeneratedField,
} from "json-ty/raw";

const binding = new RawNodeBinding(readFileSync(fileURLToPath(new URL("./runtime.wasm", import.meta.url))));
export const schemas = createSchemaRegistry(${JSON.stringify(layouts)}, { views: false });
${schemaDeclarations}
${hostViews}
export const __jsonTyRuntime = {
  binding,
  schemas,
  parseDynamic(input) {
    return binding.parseDynamic(input);
  },
  stringifyDynamic(value) {
    return binding.stringifyDynamic(value);
  },
};
${schemaBindings}
`;
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
  const hash = createHash("sha256").update(analysis.manifest.hash).update(`|codegen:${CODEGEN_VERSION}|as:0.28|O:${optimizeLevel}|z:${shrinkLevel}|simd|bulk-memory|stub`).digest("hex");
  const cacheEntry = resolve(cacheDirectory, hash);
  const cachedWasm = resolve(cacheEntry, "runtime.wasm");
  const cacheHit = existsSync(cachedWasm);

  const assemblyPath = resolve(generatedDirectory, "generated.ts");
  const layoutsPath = resolve(generatedDirectory, "schema-layouts.json");
  const manifestPath = resolve(generatedDirectory, "schema-manifest.json");
  const wasmPath = resolve(generatedDirectory, "runtime.wasm");
  const watPath = resolve(generatedDirectory, "runtime.wat");
  const runtimePath = resolve(generatedDirectory, "runtime.js");
  const assemblyBase = modulePath(generatedDirectory, resolve(packageRoot, "src/raw/assembly"));
  const generated = generateAssemblyModule(analysis.manifest.schemas, { runtimeImportBase: assemblyBase });

  writeIfChanged(assemblyPath, generated.assembly);
  writeIfChanged(layoutsPath, `${JSON.stringify(generated.layouts, null, 2)}\n`);
  writeIfChanged(manifestPath, `${JSON.stringify(analysis.manifest, null, 2)}\n`);
  writeIfChanged(runtimePath, generatedRuntimeSource(generated.layouts));

  if (cacheHit) {
    copyFileSync(cachedWasm, wasmPath);
  }

  return {
    hash,
    cacheHit,
    generatedDirectory,
    manifestPath,
    layoutsPath,
    assemblyPath,
    wasmPath,
    runtimePath,
    cacheEntry,
    cachedWasm,
    compileArguments: [assemblyPath, "--outFile", wasmPath, "--textFile", watPath, "--runtime", "stub", "--importMemory", "--zeroFilledMemory", "--enable", "simd", "--enable", "bulk-memory", "--optimizeLevel", String(optimizeLevel), "--shrinkLevel", String(shrinkLevel), "--noAssert"],
    schemaBindings: Object.fromEntries(
      generated.layouts.map((layout) => [
        layout.name,
        { parse: layout.abi!.parse, stringify: layout.abi!.serialize },
      ]),
    ),
  };
}

function cacheCompiledWasm(prepared: PreparedProject): void {
  mkdirSync(prepared.cacheEntry, { recursive: true });
  copyFileSync(prepared.wasmPath, prepared.cachedWasm);
}

async function compilePreparedProject(prepared: PreparedProject): Promise<void> {
  if (prepared.cacheHit) return;
  const { default: asc } = await import("assemblyscript/asc");
  const { error, stderr } = await asc.main(prepared.compileArguments);
  if (error) throw new Error(stderr?.toString() || String(error));
  cacheCompiledWasm(prepared);
}

function compilePreparedProjectSync(prepared: PreparedProject): void {
  if (prepared.cacheHit) return;
  const require = createRequire(import.meta.url);
  const ascPath = require.resolve("assemblyscript/bin/asc.js");
  const result = spawnSync(process.execPath, [ascPath, ...prepared.compileArguments], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || `asc exited with status ${result.status}`;
    throw new Error(detail.trim());
  }
  cacheCompiledWasm(prepared);
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
  compilePreparedProjectSync(prepared);
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
  await compilePreparedProject(prepared);

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
    assemblyPath: prepared.assemblyPath,
    wasmPath: prepared.wasmPath,
    runtimePath: prepared.runtimePath,
    emitDiagnostics,
  };
}

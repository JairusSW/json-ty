import { dirname, isAbsolute, resolve } from "node:path";
import type ts from "typescript";
import type { PluginConfig, TransformerExtras } from "ts-patch";
import {
  createGeneratedProjectTransformer,
  generateProjectSync,
  type GenerateProjectOptions,
} from "./build.js";
import { resolveKernelTier, type KernelTier } from "./kernel-tier.js";

export interface JsonTyPluginConfig extends PluginConfig {
  generatedDirectory?: string;
  cacheDirectory?: string;
  runtimeModuleSpecifier?: string;
  optimizeLevel?: 0 | 1 | 2 | 3;
  shrinkLevel?: 0 | 1 | 2;
  kernelTier?: KernelTier;
}

function projectDirectory(program: ts.Program): string {
  const configFilePath = program.getCompilerOptions().configFilePath;
  return configFilePath ? dirname(resolve(String(configFilePath))) : process.cwd();
}

function projectPath(root: string, path: string | undefined, fallback: string): string {
  const value = path ?? fallback;
  return isAbsolute(value) ? value : resolve(root, value);
}

/** ts-patch source-transformer entry point. */
export default function jsonTyTransform(
  program: ts.Program,
  config: JsonTyPluginConfig,
  extras: TransformerExtras,
): ts.TransformerFactory<ts.SourceFile> {
  const compilerMajor = Number(extras.ts.versionMajorMinor.split(".")[0]);
  if (compilerMajor !== 6) {
    throw new Error(
      `json-ty/transform requires the TypeScript 6 JavaScript compiler; received ${extras.ts.version}`,
    );
  }

  const root = projectDirectory(program);
  const generatedDirectory = projectPath(root, config.generatedDirectory, ".json-ty");
  const buildOptions: GenerateProjectOptions = {
    generatedDirectory,
    cacheDirectory: config.cacheDirectory
      ? projectPath(root, config.cacheDirectory, ".json-ty/cache")
      : resolve(generatedDirectory, "cache"),
    optimizeLevel: config.optimizeLevel,
    shrinkLevel: config.shrinkLevel,
    kernelTier: resolveKernelTier(config.kernelTier),
  };
  const generated = generateProjectSync(program, buildOptions);
  return createGeneratedProjectTransformer(
    program,
    generated,
    config.runtimeModuleSpecifier,
  );
}

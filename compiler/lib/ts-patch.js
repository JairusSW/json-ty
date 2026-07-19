import { dirname, isAbsolute, resolve } from "node:path";
import { createGeneratedProjectTransformer, generateProjectSync, } from "./build.js";
function projectDirectory(program) {
    const configFilePath = program.getCompilerOptions().configFilePath;
    return configFilePath ? dirname(resolve(String(configFilePath))) : process.cwd();
}
function projectPath(root, path, fallback) {
    const value = path ?? fallback;
    return isAbsolute(value) ? value : resolve(root, value);
}
/** ts-patch source-transformer entry point. */
export default function jsonTyTransform(program, config, extras) {
    const compilerMajor = Number(extras.ts.versionMajorMinor.split(".")[0]);
    if (compilerMajor !== 6) {
        throw new Error(`json-ty/transform requires the TypeScript 6 JavaScript compiler; received ${extras.ts.version}`);
    }
    const root = projectDirectory(program);
    const generatedDirectory = projectPath(root, config.generatedDirectory, ".json-ty");
    const buildOptions = {
        generatedDirectory,
        cacheDirectory: config.cacheDirectory
            ? projectPath(root, config.cacheDirectory, ".json-ty/cache")
            : resolve(generatedDirectory, "cache"),
        optimizeLevel: config.optimizeLevel,
        shrinkLevel: config.shrinkLevel,
    };
    const generated = generateProjectSync(program, buildOptions);
    return createGeneratedProjectTransformer(program, generated, config.runtimeModuleSpecifier);
}

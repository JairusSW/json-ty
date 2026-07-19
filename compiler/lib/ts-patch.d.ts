import type ts from "typescript";
import type { PluginConfig, TransformerExtras } from "ts-patch";
export interface JsonTyPluginConfig extends PluginConfig {
    generatedDirectory?: string;
    cacheDirectory?: string;
    runtimeModuleSpecifier?: string;
    optimizeLevel?: 0 | 1 | 2 | 3;
    shrinkLevel?: 0 | 1 | 2;
}
/** ts-patch source-transformer entry point. */
export default function jsonTyTransform(program: ts.Program, config: JsonTyPluginConfig, extras: TransformerExtras): ts.TransformerFactory<ts.SourceFile>;

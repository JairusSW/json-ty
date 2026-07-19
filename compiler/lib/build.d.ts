import ts from "typescript";
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
export type GenerateProjectOptions = Omit<BuildProjectOptions, "configPath" | "emitTypeScript" | "runtimeModuleSpecifier">;
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
export interface GeneratedProjectResult extends Omit<BuildProjectResult, "emitDiagnostics"> {
    schemaBindings: Readonly<Record<string, {
        parse: string;
        stringify: string;
    }>>;
}
export declare function createGeneratedProjectTransformer(program: ts.Program, generated: GeneratedProjectResult, runtimeModuleSpecifier?: string): ts.TransformerFactory<ts.SourceFile>;
/**
 * Generate and compile application-specific artifacts during a synchronous
 * TypeScript transform hook. Cache hits do not start an AssemblyScript process.
 */
export declare function generateProjectSync(program: ts.Program, options?: GenerateProjectOptions): GeneratedProjectResult;
export declare function buildProject(options: BuildProjectOptions): Promise<BuildProjectResult>;

import ts from "typescript";
import { type SchemaManifest } from "./schema-ir.js";
export interface AnalyzeProgramOptions {
    includeDecorated?: boolean;
}
export interface ProgramAnalysis {
    manifest: SchemaManifest;
    reachableTypes: ReadonlyMap<ts.Type, string>;
}
export declare function schemaNameForType(checker: ts.TypeChecker, type: ts.Type): string;
export declare function jsonArrayElementType(checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined;
export declare function schemaNameForRootArray(checker: ts.TypeChecker, element: ts.Type, facade?: "array" | "json-array"): string;
export declare function analyzeProgram(program: ts.Program, options?: AnalyzeProgramOptions): ProgramAnalysis;
export declare function createProgramFromConfig(configPath: string): ts.Program;

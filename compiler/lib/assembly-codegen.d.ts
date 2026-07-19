import { type ObjectLayout, type ObjectSchema } from "./schema-ir.js";
export interface GeneratedModule {
    assembly: string;
    layouts: ObjectLayout[];
}
export interface AssemblyCodegenOptions {
    runtimeImportBase?: string;
}
export declare function generateAssemblyModule(schemas: ObjectSchema[], options?: AssemblyCodegenOptions): GeneratedModule;

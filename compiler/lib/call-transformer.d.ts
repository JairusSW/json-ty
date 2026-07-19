import ts from "typescript";
export interface JsonTyTransformerOptions {
    runtimeIdentifier?: string;
    runtimeModule?: string | ((sourceFile: ts.SourceFile) => string);
    /** Direct generated host exports keyed by canonical schema name. */
    schemaBindings?: Readonly<Record<string, {
        parse: string;
        stringify: string;
    }>>;
}
export declare function createJsonTyTransformer(program: ts.Program, options?: JsonTyTransformerOptions): ts.TransformerFactory<ts.SourceFile>;

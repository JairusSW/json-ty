import type { TypeRef } from "../../schema-ir.js";
import type { AssemblyParseValueContext, AssemblySerializeValueContext, AssemblyTypeEmitter } from "./types.js";
export declare function assemblyTypeEmitter(type: TypeRef): AssemblyTypeEmitter;
export declare function emitAssemblyParseValue(type: TypeRef, context: AssemblyParseValueContext): string;
export declare function emitAssemblySerializeValue(type: TypeRef, context: AssemblySerializeValueContext): string;
export type { AssemblyParseValueContext, AssemblySerializeValueContext, AssemblyTypeEmitter, ParseFailureKind, } from "./types.js";

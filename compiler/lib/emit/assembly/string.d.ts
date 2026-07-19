import type { PrimitiveTypeRef } from "../../schema-ir.js";
import type { AssemblyTypeEmitter } from "./types.js";
type StringType = PrimitiveTypeRef & {
    kind: "string";
};
export declare const stringEmitter: AssemblyTypeEmitter<StringType>;
export {};

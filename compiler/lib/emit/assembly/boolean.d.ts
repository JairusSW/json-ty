import type { PrimitiveTypeRef } from "../../schema-ir.js";
import type { AssemblyTypeEmitter } from "./types.js";
type BooleanType = PrimitiveTypeRef & {
    kind: "boolean";
};
export declare const booleanEmitter: AssemblyTypeEmitter<BooleanType>;
export {};

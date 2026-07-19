import type { PrimitiveTypeRef } from "../../schema-ir.js";
import type { AssemblyTypeEmitter } from "./types.js";
type NumberType = PrimitiveTypeRef & {
    kind: "number";
};
export declare const numberEmitter: AssemblyTypeEmitter<NumberType>;
export {};

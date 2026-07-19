import type { PrimitiveTypeRef } from "../../schema-ir.js";
import type { HostTypeEmitter } from "./types.js";
type BooleanType = PrimitiveTypeRef & {
    kind: "boolean";
};
export declare const booleanHostEmitter: HostTypeEmitter<BooleanType>;
export {};

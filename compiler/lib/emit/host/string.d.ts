import type { PrimitiveTypeRef } from "../../schema-ir.js";
import type { HostTypeEmitter } from "./types.js";
type StringType = PrimitiveTypeRef & {
    kind: "string";
};
export declare const stringHostEmitter: HostTypeEmitter<StringType>;
export {};

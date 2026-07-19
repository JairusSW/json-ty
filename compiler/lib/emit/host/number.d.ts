import type { PrimitiveTypeRef } from "../../schema-ir.js";
import type { HostTypeEmitter } from "./types.js";
type NumberType = PrimitiveTypeRef & {
    kind: "number";
};
export declare const numberHostEmitter: HostTypeEmitter<NumberType>;
export {};

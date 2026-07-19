import type { TypeRef } from "../../schema-ir.js";
import type { HostFieldContext } from "./types.js";
export declare function emitHostAccessor(type: TypeRef, context: HostFieldContext): string;
export type { HostFieldContext, HostTypeEmitter } from "./types.js";

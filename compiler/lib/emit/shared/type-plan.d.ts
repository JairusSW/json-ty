import type { TypeRef } from "../../schema-ir.js";
/**
 * Canonical identity used by every backend when it interns a generated helper.
 * Keeping this outside either backend prevents the AS and host generators from
 * inventing subtly different notions of the same array/union shape.
 */
export declare function typeSignature(type: TypeRef): string;
/** Bytes occupied by one flattened homogeneous array element. */
export declare function elementStride(type: TypeRef): number;
export declare function isCompositeType(type: TypeRef): boolean;

import type { ObjectLayout, OmitIfExpression } from "../../schema-ir.js";
/** Emit a validated pure predicate directly against a generated flat record. */
export declare function emitOmitIfExpression(layout: ObjectLayout, expression: OmitIfExpression): string;

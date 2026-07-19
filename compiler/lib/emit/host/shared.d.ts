import type { FieldLayout } from "../../schema-ir.js";
export declare function propertyKey(name: string): string;
export declare function defaultExpression(field: FieldLayout): string;
export declare function bitmapMask(field: FieldLayout): string;
export declare function bitmapOffset(field: FieldLayout): number;

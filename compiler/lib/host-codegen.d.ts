import type { ObjectLayout } from "./schema-ir.js";
/**
 * Emit real JS classes instead of constructing hot getters from descriptors at
 * application startup. Primitive and UTF-8 string fields contain fixed offsets;
 * composite fields use one shared cold materialization helper.
 */
export declare function generateHostViewSource(layouts: ObjectLayout[]): string;

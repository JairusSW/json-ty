import type { FieldLayout, ObjectLayout, TypeRef } from "../../schema-ir.js";
export interface HostFieldContext {
    layout: ObjectLayout;
    field: FieldLayout;
    schemaVariable: string;
    cacheVariable?: string;
}
export interface HostTypeEmitter<T extends TypeRef = TypeRef> {
    readonly kind: T["kind"];
    emitAccessor(type: T, context: HostFieldContext): string;
}

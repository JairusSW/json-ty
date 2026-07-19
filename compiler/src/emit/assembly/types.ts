import type { ObjectLayout, TypeRef } from "../../schema-ir.js";

export type ParseFailureKind =
  | "boolean"
  | "number"
  | "string"
  | "object"
  | "array"
  | "union";

export interface AssemblyParseValueContext {
  cursor: string;
  end: string;
  destination: string;
  document: string;
  resolveLayout(typeName: string): ObjectLayout;
  resolveArrayHelper(type: TypeRef & { kind: "array" }): string;
  resolveUnionHelper(type: TypeRef & { kind: "union" }): string;
  /** A complete AS statement, normally a return, for a failed value parse. */
  fail(kind: ParseFailureKind, pointer: string): string;
}

export interface AssemblySerializeValueContext {
  source: string;
  document: string;
  resolveArrayHelper(type: TypeRef & { kind: "array" }): string;
  /** A complete AS statement executed when a writer helper returns false. */
  fail: string;
}

export interface AssemblyTypeEmitter<T extends TypeRef = TypeRef> {
  readonly kind: T["kind"];
  emitParse(type: T, context: AssemblyParseValueContext): string;
  emitSerialize(type: T, context: AssemblySerializeValueContext): string;
}


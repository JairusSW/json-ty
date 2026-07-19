import type { TypeRef } from "../../schema-ir.js";
import { arrayEmitter } from "./array.js";
import { booleanEmitter } from "./boolean.js";
import { numberEmitter } from "./number.js";
import { objectEmitter } from "./object.js";
import { stringEmitter } from "./string.js";
import type {
  AssemblyParseValueContext,
  AssemblySerializeValueContext,
  AssemblyTypeEmitter,
} from "./types.js";
import { unionEmitter } from "./union.js";

const emitters: Record<TypeRef["kind"], AssemblyTypeEmitter> = {
  number: numberEmitter as AssemblyTypeEmitter,
  boolean: booleanEmitter as AssemblyTypeEmitter,
  string: stringEmitter as AssemblyTypeEmitter,
  object: objectEmitter as AssemblyTypeEmitter,
  array: arrayEmitter as AssemblyTypeEmitter,
  union: unionEmitter as AssemblyTypeEmitter,
};

export function assemblyTypeEmitter(type: TypeRef): AssemblyTypeEmitter {
  return emitters[type.kind];
}

export function emitAssemblyParseValue(
  type: TypeRef,
  context: AssemblyParseValueContext,
): string {
  return assemblyTypeEmitter(type).emitParse(type, context);
}

export function emitAssemblySerializeValue(
  type: TypeRef,
  context: AssemblySerializeValueContext,
): string {
  return assemblyTypeEmitter(type).emitSerialize(type, context);
}

export type {
  AssemblyParseValueContext,
  AssemblySerializeValueContext,
  AssemblyTypeEmitter,
  ParseFailureKind,
} from "./types.js";


import type { TypeRef } from "../../schema-ir.js";
import { arrayHostEmitter } from "./array.js";
import { booleanHostEmitter } from "./boolean.js";
import { numberHostEmitter } from "./number.js";
import { nullHostEmitter } from "./null.js";
import { objectHostEmitter } from "./object.js";
import { stringHostEmitter } from "./string.js";
import type { HostFieldContext, HostTypeEmitter } from "./types.js";
import { unionHostEmitter } from "./union.js";
import { hostHostEmitter } from "./host.js";

const emitters: Record<TypeRef["kind"], HostTypeEmitter> = {
  number: numberHostEmitter as HostTypeEmitter,
  boolean: booleanHostEmitter as HostTypeEmitter,
  string: stringHostEmitter as HostTypeEmitter,
  null: nullHostEmitter as HostTypeEmitter,
  object: objectHostEmitter as HostTypeEmitter,
  array: arrayHostEmitter as HostTypeEmitter,
  union: unionHostEmitter as HostTypeEmitter,
  host: hostHostEmitter as HostTypeEmitter,
};

export function emitHostAccessor(type: TypeRef, context: HostFieldContext): string {
  return emitters[type.kind].emitAccessor(type, context);
}

export type { HostFieldContext, HostTypeEmitter } from "./types.js";

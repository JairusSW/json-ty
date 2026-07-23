import type { PrimitiveTypeRef } from "../../schema-ir.js";
import type { AssemblyTypeEmitter } from "./types.js";

type NullType = PrimitiveTypeRef & { kind: "null" };

export const nullEmitter: AssemblyTypeEmitter<NullType> = {
  kind: "null",
  emitParse(_type, context) {
    return `const nullEnd = deserializeNull(${context.cursor}, ${context.end});
    if (nullEnd == 0) ${context.fail("null", context.cursor)}
    ${context.cursor} = nullEnd;`;
  },
  emitSerialize(_type, context) {
    return `if (!serializeNull()) ${context.fail}`;
  },
};

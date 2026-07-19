import type { PrimitiveTypeRef } from "../../schema-ir.js";
import type { AssemblyTypeEmitter } from "./types.js";

type StringType = PrimitiveTypeRef & { kind: "string" };

export const stringEmitter: AssemblyTypeEmitter<StringType> = {
  kind: "string",
  emitParse(_type, context) {
    return `const stringEnd = deserializeString(${context.cursor}, ${context.end}, ${context.destination}, ${context.document});
    if (stringEnd == 0) ${context.fail("string", context.cursor)}
    ${context.cursor} = stringEnd;`;
  },
  emitSerialize(_type, context) {
    return `if (!serializeString(${context.document}, ${context.source})) ${context.fail}`;
  },
};


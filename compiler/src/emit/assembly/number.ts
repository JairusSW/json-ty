import type { PrimitiveTypeRef } from "../../schema-ir.js";
import type { AssemblyTypeEmitter } from "./types.js";

type NumberType = PrimitiveTypeRef & { kind: "number" };

export const numberEmitter: AssemblyTypeEmitter<NumberType> = {
  kind: "number",
  emitParse(_type, context) {
    return `const numberEnd = deserializeF64(${context.cursor}, ${context.end}, ${context.destination});
    if (numberEnd == 0) ${context.fail("number", context.cursor)}
    ${context.cursor} = numberEnd;`;
  },
  emitSerialize(_type, context) {
    return `if (!serializeF64(load<f64>(${context.source}))) ${context.fail}`;
  },
};


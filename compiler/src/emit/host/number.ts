import type { PrimitiveTypeRef } from "../../schema-ir.js";
import { emitScalarAccessor } from "./scalar.js";
import type { HostTypeEmitter } from "./types.js";

type NumberType = PrimitiveTypeRef & { kind: "number" };

export const numberHostEmitter: HostTypeEmitter<NumberType> = {
  kind: "number",
  emitAccessor(_type, context) {
    return emitScalarAccessor(
      context,
      `runtime.f64[(root + ${context.field.offset}) >>> 3]`,
    );
  },
};


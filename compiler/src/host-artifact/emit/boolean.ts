import type { PrimitiveTypeRef } from "../../schema-ir.js";
import { emitScalarAccessor } from "./scalar.js";
import type { HostTypeEmitter } from "./types.js";

type BooleanType = PrimitiveTypeRef & { kind: "boolean" };

export const booleanHostEmitter: HostTypeEmitter<BooleanType> = {
  kind: "boolean",
  emitAccessor(_type, context) {
    return emitScalarAccessor(
      context,
      `runtime.u32[(root + ${context.field.offset}) >>> 2] !== 0`,
    );
  },
};


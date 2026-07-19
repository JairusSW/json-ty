import type { ArrayTypeRef } from "../../schema-ir.js";
import { emitCompositeAccessor } from "./composite.js";
import type { HostTypeEmitter } from "./types.js";

export const arrayHostEmitter: HostTypeEmitter<ArrayTypeRef> = {
  kind: "array",
  emitAccessor(_type, context) {
    return emitCompositeAccessor(context);
  },
};


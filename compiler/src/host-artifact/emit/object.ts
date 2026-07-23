import type { ObjectTypeRef } from "../../schema-ir.js";
import { emitCompositeAccessor } from "./composite.js";
import type { HostTypeEmitter } from "./types.js";

export const objectHostEmitter: HostTypeEmitter<ObjectTypeRef> = {
  kind: "object",
  emitAccessor(_type, context) {
    return emitCompositeAccessor(context);
  },
};


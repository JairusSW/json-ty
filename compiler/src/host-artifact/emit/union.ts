import type { UnionTypeRef } from "../../schema-ir.js";
import { emitCompositeAccessor } from "./composite.js";
import type { HostTypeEmitter } from "./types.js";

export const unionHostEmitter: HostTypeEmitter<UnionTypeRef> = {
  kind: "union",
  emitAccessor(_type, context) {
    return emitCompositeAccessor(context);
  },
};


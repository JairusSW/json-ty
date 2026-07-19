import { emitCompositeAccessor } from "./composite.js";
export const unionHostEmitter = {
    kind: "union",
    emitAccessor(_type, context) {
        return emitCompositeAccessor(context);
    },
};

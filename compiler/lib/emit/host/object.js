import { emitCompositeAccessor } from "./composite.js";
export const objectHostEmitter = {
    kind: "object",
    emitAccessor(_type, context) {
        return emitCompositeAccessor(context);
    },
};

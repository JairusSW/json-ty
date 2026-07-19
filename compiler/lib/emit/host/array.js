import { emitCompositeAccessor } from "./composite.js";
export const arrayHostEmitter = {
    kind: "array",
    emitAccessor(_type, context) {
        return emitCompositeAccessor(context);
    },
};

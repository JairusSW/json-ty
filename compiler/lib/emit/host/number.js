import { emitScalarAccessor } from "./scalar.js";
export const numberHostEmitter = {
    kind: "number",
    emitAccessor(_type, context) {
        return emitScalarAccessor(context, `runtime.f64[(root + ${context.field.offset}) >>> 3]`);
    },
};

import { emitScalarAccessor } from "./scalar.js";
export const booleanHostEmitter = {
    kind: "boolean",
    emitAccessor(_type, context) {
        return emitScalarAccessor(context, `runtime.u32[(root + ${context.field.offset}) >>> 2] !== 0`);
    },
};

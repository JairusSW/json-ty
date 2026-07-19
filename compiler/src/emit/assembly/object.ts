import type { ObjectTypeRef } from "../../schema-ir.js";
import type { AssemblyTypeEmitter } from "./types.js";

export const objectEmitter: AssemblyTypeEmitter<ObjectTypeRef> = {
  kind: "object",
  emitParse(type, context) {
    const layout = context.resolveLayout(type.typeName);
    return `const nestedRecord = graphAllocate(${layout.recordSize}, 8);
    if (nestedRecord == 0 || !initialize${layout.name}Record(nestedRecord)) ${context.fail("object", context.cursor)}
    const nestedEnd = parse${layout.name}Record(${context.cursor}, ${context.end}, nestedRecord);
    if (nestedEnd == 0) ${context.fail("object", context.cursor)}
    store<u32>(${context.destination}, <u32>(nestedRecord - ${context.document}));
    ${context.cursor} = nestedEnd;`;
  },
  emitSerialize(type, context) {
    return `if (!serialize${type.typeName}Record(${context.document} + load<u32>(${context.source}), ${context.document})) ${context.fail}`;
  },
};


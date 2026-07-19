export const arrayEmitter = {
    kind: "array",
    emitParse(type, context) {
        const helper = context.resolveArrayHelper(type);
        return `const arrayEnd = parse${helper}(${context.cursor}, ${context.end}, ${context.destination});
    if (arrayEnd == 0) ${context.fail("array", context.cursor)}
    ${context.cursor} = arrayEnd;`;
    },
    emitSerialize(type, context) {
        const helper = context.resolveArrayHelper(type);
        return `if (!serialize${helper}(${context.document} + load<u32>(${context.source}), ${context.document})) ${context.fail}`;
    },
};

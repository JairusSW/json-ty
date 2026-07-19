export const booleanEmitter = {
    kind: "boolean",
    emitParse(_type, context) {
        return `const booleanEnd = deserializeBoolean(${context.cursor}, ${context.end}, ${context.destination});
    if (booleanEnd == 0) ${context.fail("boolean", context.cursor)}
    ${context.cursor} = booleanEnd;`;
    },
    emitSerialize(_type, context) {
        return `if (!serializeBoolean(load<u32>(${context.source}))) ${context.fail}`;
    },
};

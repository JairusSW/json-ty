export const numberEmitter = {
    kind: "number",
    emitParse(_type, context) {
        return `const numberEnd = deserializeF64(${context.cursor}, ${context.end}, ${context.destination});
    if (numberEnd == 0) ${context.fail("number", context.cursor)}
    ${context.cursor} = numberEnd;`;
    },
    emitSerialize(_type, context) {
        return `if (!serializeF64(load<f64>(${context.source}))) ${context.fail}`;
    },
};

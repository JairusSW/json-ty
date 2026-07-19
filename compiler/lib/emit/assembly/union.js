export const unionEmitter = {
    kind: "union",
    emitParse(type, context) {
        const helper = context.resolveUnionHelper(type);
        const cases = type.variants
            .map((variant, index) => {
            const layout = context.resolveLayout(variant.typeName);
            return `case ${index}: {
        const unionRecord = graphAllocate(${layout.recordSize}, 8);
        if (unionRecord == 0 || !initialize${layout.name}Record(unionRecord)) ${context.fail("union", context.cursor)}
        const unionEnd = parse${layout.name}Record(${context.cursor}, ${context.end}, unionRecord);
        if (unionEnd == 0) ${context.fail("union", context.cursor)}
        store<u32>(${context.destination}, <u32>(unionRecord - ${context.document}));
        store<u32>(${context.destination} + 4, ${index});
        ${context.cursor} = unionEnd;
        break;
      }`;
        })
            .join("\n      ");
        return `const unionVariant = detect${helper}(${context.cursor}, ${context.end});
    if (unionVariant < 0) ${context.fail("union", context.cursor)}
    switch (unionVariant) {
      ${cases}
      default: ${context.fail("union", context.cursor)}
    }`;
    },
    emitSerialize(type, context) {
        const cases = type.variants
            .map((variant, index) => `case ${index}: if (!serialize${variant.typeName}Record(${context.document} + load<u32>(${context.source}), ${context.document})) ${context.fail} break;`)
            .join("\n      ");
        return `switch (load<u32>(${context.source} + 4)) {
      ${cases}
      default: ${context.fail}
    }`;
    },
};

function mask(index) {
    return `0x${(1 << (index & 31) >>> 0).toString(16)}`;
}
function presence(index) {
    const word = index >>> 5;
    return word === 0 ? "presence" : `presence${word}`;
}
/** Emit a validated pure predicate directly against a generated flat record. */
export function emitOmitIfExpression(layout, expression) {
    switch (expression.kind) {
        case "literal":
            return JSON.stringify(expression.value);
        case "field": {
            const field = layout.fields.find((candidate) => candidate.name === expression.name);
            if (!field)
                throw new Error(`Missing @omitif field ${layout.name}.${expression.name}`);
            const fallback = JSON.stringify(field.defaultValue);
            const value = field.kind === "number"
                ? `load<f64>(record + ${field.offset})`
                : `load<u32>(record + ${field.offset}) != 0`;
            return `(((${presence(field.index)} & ${mask(field.index)}) != 0) ? ${value} : ${fallback})`;
        }
        case "unary":
            return `(${expression.operator}${emitOmitIfExpression(layout, expression.operand)})`;
        case "binary":
            return `(${emitOmitIfExpression(layout, expression.left)} ${expression.operator} ${emitOmitIfExpression(layout, expression.right)})`;
    }
}

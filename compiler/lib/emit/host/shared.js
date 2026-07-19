export function propertyKey(name) {
    return `[${JSON.stringify(name)}]`;
}
export function defaultExpression(field) {
    return field.defaultValue === undefined ? "undefined" : JSON.stringify(field.defaultValue);
}
export function bitmapMask(field) {
    return `0x${(1 << (field.index & 31) >>> 0).toString(16)}`;
}
export function bitmapOffset(field) {
    return (field.index >>> 5) * 4;
}

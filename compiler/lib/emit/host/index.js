import { arrayHostEmitter } from "./array.js";
import { booleanHostEmitter } from "./boolean.js";
import { numberHostEmitter } from "./number.js";
import { objectHostEmitter } from "./object.js";
import { stringHostEmitter } from "./string.js";
import { unionHostEmitter } from "./union.js";
const emitters = {
    number: numberHostEmitter,
    boolean: booleanHostEmitter,
    string: stringHostEmitter,
    object: objectHostEmitter,
    array: arrayHostEmitter,
    union: unionHostEmitter,
};
export function emitHostAccessor(type, context) {
    return emitters[type.kind].emitAccessor(type, context);
}

import { arrayEmitter } from "./array.js";
import { booleanEmitter } from "./boolean.js";
import { numberEmitter } from "./number.js";
import { objectEmitter } from "./object.js";
import { stringEmitter } from "./string.js";
import { unionEmitter } from "./union.js";
const emitters = {
    number: numberEmitter,
    boolean: booleanEmitter,
    string: stringEmitter,
    object: objectEmitter,
    array: arrayEmitter,
    union: unionEmitter,
};
export function assemblyTypeEmitter(type) {
    return emitters[type.kind];
}
export function emitAssemblyParseValue(type, context) {
    return assemblyTypeEmitter(type).emitParse(type, context);
}
export function emitAssemblySerializeValue(type, context) {
    return assemblyTypeEmitter(type).emitSerialize(type, context);
}

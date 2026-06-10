import { COMMA, EMPTY_ARRAY, LEFT_BRACKET, RIGHT_BRACKET } from "../chars.js";
import { serializeString } from "./string.js";

// Above this length, V8's native JSON.stringify on the whole array beats a
// JS-level running concat (its internal buffer avoids rope-building overhead),
// so we delegate. Below it, the specialized concat wins. See bench/prof notes.
const NATIVE_ARRAY_THRESHOLD = 32;

/**
 * Generic fallback for element types json-ty doesn't specialize (nested
 * arrays, plain objects, unions). Delegates the whole array to the native
 * serializer in one call — correct for any JSON-compatible data and far faster
 * than the old per-element JSON.stringify loop.
 */
export function serializeArray(data) {
  return JSON.stringify(data);
}

export function serializeFloatArray(data) {
  const len = data.length;
  if (len === 0) return EMPTY_ARRAY;
  if (len > NATIVE_ARRAY_THRESHOLD) return JSON.stringify(data);
  const last = len - 1;
  let result = LEFT_BRACKET;
  let x = 0;
  for (let i = 0; i < last; i++) {
    x = data[i];
    result += (Number.isFinite(x) ? x : "null") + COMMA;
  }
  x = data[last];
  return result + (Number.isFinite(x) ? x : "null") + RIGHT_BRACKET;
}

export function serializeIntegerArray(data) {
  const len = data.length;
  if (len === 0) return EMPTY_ARRAY;
  if (len > NATIVE_ARRAY_THRESHOLD) return JSON.stringify(data);
  const last = len - 1;
  let result = LEFT_BRACKET;
  for (let i = 0; i < last; i++) result += (data[i] | 0) + COMMA;
  return result + (data[last] | 0) + RIGHT_BRACKET;
}

export function serializeBoolArray(data) {
  const len = data.length;
  if (len === 0) return EMPTY_ARRAY;
  if (len > NATIVE_ARRAY_THRESHOLD) return JSON.stringify(data);
  const last = len - 1;
  let result = LEFT_BRACKET;
  for (let i = 0; i < last; i++) result += (data[i] ? "true" : "false") + COMMA;
  return result + (data[last] ? "true" : "false") + RIGHT_BRACKET;
}

export function serializeStringArray(data) {
  const len = data.length;
  if (len === 0) return EMPTY_ARRAY;
  if (len > NATIVE_ARRAY_THRESHOLD) return JSON.stringify(data);
  const last = len - 1;
  let result = LEFT_BRACKET;
  for (let i = 0; i < last; i++) result += serializeString(data[i]) + COMMA;
  return result + serializeString(data[last]) + RIGHT_BRACKET;
}

/**
 * Arrays of @json structs: native JSON.stringify cannot honor @alias/@omit, so
 * we must route each element through its generated __JSON_SERIALIZE.
 */
export function serializeStructArray(data, cls) {
  const len = data.length;
  if (len === 0) return EMPTY_ARRAY;
  const last = len - 1;
  let result = LEFT_BRACKET;
  for (let i = 0; i < last; i++) result += cls.__JSON_SERIALIZE(data[i]) + COMMA;
  return result + cls.__JSON_SERIALIZE(data[last]) + RIGHT_BRACKET;
}

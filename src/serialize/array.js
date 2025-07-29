import { COMMA, EMPTY_ARRAY, LEFT_BRACKET, RIGHT_BRACKET } from "../chars.js";

export function serializeArray(data) {
  const len = (data.length - 1) | 0;
  if (len === -1) {
    return EMPTY_ARRAY;
  }
  let result = LEFT_BRACKET;
  for (let i = 0 | 0; i < len; i++) {
    result += JSON.stringify(data[i]) + COMMA;
  }
  const lastChunk = data[len];
  result += JSON.stringify(lastChunk) + RIGHT_BRACKET;
  return result;
}
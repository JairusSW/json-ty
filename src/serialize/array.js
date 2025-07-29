import { COMMA, EMPTY_ARRAY, LEFT_BRACKET, RIGHT_BRACKET } from "../chars.js";

export function serializeArray(data) {
  const len = (data.length - 1) | 0;
  if (len === -1) {
    return EMPTY_ARRAY;
  }
  let result = LEFT_BRACKET;
  for (let i = 0 | 0; i < len; i++) {
    result += serializeVec3(data[i]) + COMMA;
  }
  const lastChunk = data[len];
  result += serializeVec3(lastChunk) + RIGHT_BRACKET;
  return result;
}

function serializeVec3(v) {
  return `{"x":${v.x},"y":${v.y},"z":${v.z}}`;
}
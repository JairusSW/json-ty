export function serializeStruct(data, cls) {
  return cls.__JSON_SERIALIZE(data);
}
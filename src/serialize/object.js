export function serializeObject(data, cls) {
  return cls.__JSON_SERIALIZE(data);
}
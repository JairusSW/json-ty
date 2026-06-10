export function serializeStruct(data, cls) {
  // Nullable struct fields (`pos: Vec3 | null`) must match native, which emits
  // "null" rather than dereferencing the missing instance.
  return data === null ? "null" : cls.__JSON_SERIALIZE(data);
}

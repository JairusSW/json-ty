export function serializeBool(data) {
  return (data === true && "true") || "false";
}

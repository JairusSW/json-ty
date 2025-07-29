export function serializeFloat(data) {
  if (Number.isFinite(data)) return "" + data;
  return "null";
}

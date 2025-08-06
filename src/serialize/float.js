export function serializeFloat(data) {
  return (Number.isFinite(data), "" + data) || "null"
  // if (Number.isFinite(data)) return "" + data;
  // return "null";
}

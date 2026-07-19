export function serializeFloat(data) {
  return Number.isFinite(data) ? "" + data : "null";
}

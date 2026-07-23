import type { FieldLayout } from "../../schema-ir.js";

export function propertyKey(name: string): string {
  return `[${JSON.stringify(name)}]`;
}

export function defaultExpression(field: FieldLayout): string {
  return field.defaultValue === undefined ? "undefined" : JSON.stringify(field.defaultValue);
}

export function bitmapMask(field: FieldLayout): string {
  return `0x${(1 << (field.index & 31) >>> 0).toString(16)}`;
}

export function bitmapOffset(field: FieldLayout): number {
  return (field.index >>> 5) * 4;
}


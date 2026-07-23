import type { TypeRef } from "../../schema-ir.js";

/**
 * Canonical identity used by every backend when it interns a generated helper.
 * Keeping this outside either backend prevents the AS and host generators from
 * inventing subtly different notions of the same array/union shape.
 */
export function typeSignature(type: TypeRef): string {
  if (type.kind === "array") {
    return type.elements
      ? `tuple<${type.elements.map(typeSignature).join(",")}>`
      : `array<${typeSignature(type.element)}>`;
  }
  if (type.kind === "object") return `object<${type.typeName}>`;
  if (type.kind === "union") {
    return `union<${type.discriminator}:${type.variants
      .map((variant) => `${variant.typeName}=${String(variant.discriminatorValue)}`)
      .join(",")}>`;
  }
  return type.kind;
}

/** Bytes occupied by one flattened homogeneous array element. */
export function elementStride(type: TypeRef): number {
  if (type.kind === "array" && type.elements) return 16;
  if (
    type.kind === "number" ||
    type.kind === "string" ||
    type.kind === "union" ||
    type.kind === "array"
  ) {
    return 8;
  }
  return 4;
}

export function isCompositeType(type: TypeRef): boolean {
  return type.kind === "object" || type.kind === "array" || type.kind === "union";
}

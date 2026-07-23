import type { FieldLayout, ObjectLayout, TypeRef } from "../schema-ir.js";

const encoder = new TextEncoder();

function byteLiteral(value: number): string {
  return `0x${value.toString(16).padStart(2, "0")}`;
}

function integerLiteral(bytes: Uint8Array, offset: number, size: number): string {
  let value = 0n;
  for (let index = 0; index < size; index++) {
    value |= BigInt(bytes[offset + index]!) << BigInt(index * 8);
  }
  return `0x${value.toString(16)}`;
}

function vectorMatch(pointer: string, bytes: Uint8Array, offset: number): string {
  const lanes = [...bytes.slice(offset, offset + 16)]
    .map((value) => value < 128 ? value : value - 256)
    .join(", ");
  return `(ASC_FEATURE_SIMD ? !v128.any_true(v128.xor(v128.load(${pointer} + ${offset}), v128(${lanes}))) : (load<u64>(${pointer} + ${offset}) == ${integerLiteral(bytes, offset, 8)} && load<u64>(${pointer} + ${offset + 8}) == ${integerLiteral(bytes, offset + 8, 8)}))`;
}

function bytesEqual(pointer: string, bytes: Uint8Array): string[] {
  const checks: string[] = [];
  let offset = 0;
  while (offset + 16 <= bytes.length) {
    checks.push(vectorMatch(pointer, bytes, offset));
    offset += 16;
  }
  for (const size of [8, 4, 2, 1]) {
    while (offset + size <= bytes.length) {
      checks.push(`load<u${size * 8}>(${pointer} + ${offset}) == ${integerLiteral(bytes, offset, size)}`);
      offset += size;
    }
  }
  return checks;
}

function keyMatch(field: FieldLayout): string {
  const bytes = encoder.encode(field.jsonName!);
  return [`keyLength == ${bytes.length}`, ...bytesEqual("keyStart", bytes)].join(" && ");
}

function keyDataName(layout: ObjectLayout, field: FieldLayout): string {
  return `KEY_${layout.name}_${field.index}`;
}

function keyDataDeclarations(layout: ObjectLayout): string {
  return layout.fields.map((field) => {
    const bytes = encoder.encode(field.jsonName!);
    const initializer = bytes.length === 0
      ? "memory.data(1)"
      : `memory.data<u8>([${[...bytes].join(",")}])`;
    return `const ${keyDataName(layout, field)}: usize = ${initializer};`;
  }).join("\n");
}

function fullKeyMatch(layout: ObjectLayout, field: FieldLayout): string {
  const length = encoder.encode(field.jsonName!).length;
  return `((${keyMatch(field)}) || matchJsonKey(keyStart, keyQuote, ${keyDataName(layout, field)}, ${length}))`;
}

function orderedKeyMatch(field: FieldLayout, end: string): string {
  const bytes = encoder.encode(`${JSON.stringify(field.jsonName)}:`);
  return [`cursor + ${bytes.length} <= ${end}`, ...bytesEqual("cursor", bytes)].join(" && ");
}

function orderedQuotedKeyMatch(field: FieldLayout, pointer: string, end: string): string {
  const bytes = encoder.encode(JSON.stringify(field.jsonName));
  return [`${pointer} + ${bytes.length} <= ${end}`, ...bytesEqual(pointer, bytes)].join(" && ");
}

function bytesMatch(pointer: string, value: string, length?: string): string {
  const bytes = encoder.encode(value);
  const checks = bytesEqual(pointer, bytes);
  if (length !== undefined) checks.unshift(`${length} == ${bytes.length}`);
  return checks.length === 0 ? "true" : checks.join(" && ");
}

function packedWrites(value: string, failure: string, indentation = "  "): string {
  const bytes = encoder.encode(value);
  const writes: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8) {
    const length = Math.min(8, bytes.length - offset);
    writes.push(`${indentation}if (!writePacked(${integerLiteral(bytes, offset, length)}, ${length})) ${failure}`);
  }
  return writes.join("\n");
}

function rawStores(pointer: string, bytes: Uint8Array, indentation: string): string {
  const stores: string[] = [];
  let offset = 0;
  for (const size of [8, 4, 2, 1]) {
    while (offset + size <= bytes.length) {
      stores.push(`${indentation}store<u${size * 8}>(${pointer} + ${offset}, ${integerLiteral(bytes, offset, size)});`);
      offset += size;
    }
  }
  return stores.join("\n");
}

function typeOf(field: FieldLayout): TypeRef {
  return field.type ?? ({ kind: field.kind } as TypeRef);
}

function isDeferred(field: FieldLayout): boolean {
  return field.decorators?.lazy === true && field.kind !== "string";
}

function bitmapWord(field: FieldLayout): number {
  return field.index >>> 5;
}

function bitmapMask(field: FieldLayout): string {
  return `0x${(1 << (field.index & 31) >>> 0).toString(16)}`;
}

function bitmapVariable(kind: "presence" | "nulls" | "lazy", field: FieldLayout): string {
  const word = bitmapWord(field);
  return word === 0 ? kind : `${kind}${word}`;
}

function bitmapDeclarations(
  layout: ObjectLayout,
  kind: "presence" | "nulls" | "lazy",
  offset?: number,
  mutable = true,
): string {
  const declaration = mutable ? "let" : "const";
  return Array.from({ length: layout.bitmapWords }, (_, word) => {
    const name = word === 0 ? kind : `${kind}${word}`;
    const value = offset === undefined ? "0" : `load<u32>(record + ${offset + word * 4})`;
    return `  ${declaration} ${name}: u32 = ${value};`;
  }).join("\n");
}

function bitmapStores(
  layout: ObjectLayout,
  kind: "presence" | "nulls" | "lazy",
  offset: number,
  indentation = "    ",
): string {
  return Array.from({ length: layout.bitmapWords }, (_, word) => {
    const name = word === 0 ? kind : `${kind}${word}`;
    return `store<u32>(record + ${offset + word * 4}, ${name});`;
  }).join(`\n${indentation}`);
}

function bitmapStateStores(layout: ObjectLayout, indentation = "    "): string {
  return layout.bitmapWords === 1
    ? "store<u64>(record, <u64>presence | (<u64>nulls << 32));"
    : `${bitmapStores(layout, "presence", 0, indentation)}
${indentation}${bitmapStores(layout, "nulls", layout.nullOffset, indentation)}`;
}

function bitmapResets(layout: ObjectLayout): string {
  return (["presence", "nulls", "lazy"] as const)
    .flatMap((kind) => Array.from(
      { length: layout.bitmapWords },
      (_, word) => `${word === 0 ? kind : `${kind}${word}`} = 0;`,
    ))
    .join("\n  ");
}

function defaultDocumentJson(layout: ObjectLayout): string | undefined {
  if (!layout.features.deserialize.defaultDocument) return undefined;
  const fields: string[] = [];
  for (const field of layout.fields) {
    if (
      field.decorators?.omit ||
      field.defaultValue === undefined ||
      (field.defaultValue === null && field.decorators?.omitNull)
    ) continue;
    fields.push(`${JSON.stringify(field.jsonName)}:${JSON.stringify(field.defaultValue)}`);
  }
  return `{${fields.join(",")}}`;
}

function sourcePreservesOutput(layout: ObjectLayout, requireRetainedSource = false): boolean {
  return (!requireRetainedSource || layout.features.retainsSource) && layout.fields.every((field) =>
    field.defaultValue === undefined &&
    !field.decorators?.omit &&
    !field.decorators?.omitNull &&
    !field.decorators?.omitIf &&
    !field.decorators?.raw &&
    !field.decorators?.codec &&
    !field.hostManaged
  );
}

/** Shared record policy consumed by flat and graph allocation adapters. */
export const recordPolicy = {
  encoder,
  byteLiteral,
  integerLiteral,
  vectorMatch,
  keyMatch,
  keyDataName,
  keyDataDeclarations,
  fullKeyMatch,
  orderedKeyMatch,
  orderedQuotedKeyMatch,
  bytesMatch,
  packedWrites,
  rawStores,
  typeOf,
  isDeferred,
  bitmapWord,
  bitmapMask,
  bitmapVariable,
  bitmapDeclarations,
  bitmapStores,
  bitmapStateStores,
  bitmapResets,
  defaultDocumentJson,
  sourcePreservesOutput,
};

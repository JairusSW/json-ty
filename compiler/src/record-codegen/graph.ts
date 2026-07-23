import type { FieldLayout, ObjectLayout, TypeRef } from "../schema-ir.js";
import {
  emitAssemblyParseValue,
  emitAssemblySerializeValue,
} from "../emit/assembly/index.js";
import { elementStride, typeSignature } from "../emit/shared/type-plan.js";
import { emitOmitIfExpression } from "../emit/shared/omit-if.js";
import { recordPolicy } from "./policy.js";

const {
  bitmapDeclarations,
  bitmapMask,
  bitmapStateStores,
  bitmapStores,
  bitmapVariable,
  bitmapWord,
  fullKeyMatch,
  isDeferred,
  packedWrites,
  typeOf,
} = recordPolicy;

const encoder = recordPolicy.encoder;

function orderedKeyMatch(field: FieldLayout): string {
  return recordPolicy.orderedKeyMatch(field, "end");
}

function orderedQuotedKeyMatch(field: FieldLayout, pointer: string): string {
  return recordPolicy.orderedQuotedKeyMatch(field, pointer, "end");
}

function bytesMatch(pointer: string, length: string, value: string): string {
  return recordPolicy.bytesMatch(pointer, value, length);
}

function parseDeferred(field: FieldLayout, minified = false): string {
  const lazy = bitmapVariable("lazy", field);
  return `const valueStart = cursor;
    const valueEnd = ${minified ? "(graphBoundaryTrusted ? skipValueMinifiedTrusted : skipValueMinified)" : "skipValue"}(cursor, end);
    if (valueEnd == 0) return graphFailure(cursor);
    store<u32>(record + ${field.offset}, <u32>(valueStart - graphDocument));
    store<u32>(record + ${field.offset + 4}, <u32>(valueEnd - valueStart));
    ${lazy} |= ${bitmapMask(field)};
    cursor = valueEnd;`;
}

function sourcePreservesOutput(layout: ObjectLayout): boolean {
  return recordPolicy.sourcePreservesOutput(layout);
}

function defaultDocumentFastPath(layout: ObjectLayout): string {
  const json = recordPolicy.defaultDocumentJson(layout);
  if (json === undefined) return "";
  return `  if (output == 0 && ${bytesMatch("<usize>source", "length", json)}) {
    const defaultTotal: u32 = ${16 + layout.recordSize};
    const defaultDocument = allocateDocument(defaultTotal);
    if (defaultDocument == 0) return 0;
    storeDocumentHeader(<usize>defaultDocument, defaultTotal, 0, 0, 16);
    memory.fill(<usize>defaultDocument + 16, 0, ${layout.recordSize});
    setResultRoot(16);
    return defaultDocument;
  }
`;
}

function graphSourcePreservesOutput(layout: ObjectLayout, layouts: ReadonlyMap<string, ObjectLayout>, memo: Map<string, boolean>, visiting = new Set<string>()): boolean {
  const cached = memo.get(layout.name);
  if (cached !== undefined) return cached;
  if (!sourcePreservesOutput(layout)) {
    memo.set(layout.name, false);
    return false;
  }
  // Recursive edges do not change policy; the first visit validates every
  // field on the cycle before its result is memoized.
  if (visiting.has(layout.name)) return true;
  visiting.add(layout.name);
  const typePreserves = (type: TypeRef): boolean => {
    if (type.kind === "object") {
      const nested = layouts.get(type.typeName);
      return nested !== undefined && graphSourcePreservesOutput(nested, layouts, memo, visiting);
    }
    if (type.kind === "union") {
      return type.variants.every((variant) => {
        const nested = layouts.get(variant.typeName);
        return nested !== undefined && graphSourcePreservesOutput(nested, layouts, memo, visiting);
      });
    }
    if (type.kind === "array") return type.elements ? type.elements.every(typePreserves) : typePreserves(type.element);
    return true;
  };
  const result = layout.fields.every((field) => typePreserves(typeOf(field)));
  visiting.delete(layout.name);
  memo.set(layout.name, result);
  return result;
}

function graphPrelude(): string {
  return `
let graphDocument: usize = 0;
let graphCursor: usize = 0;
let graphLimit: usize = 0;
let graphScratch: usize = 0;
let graphSource: usize = 0;
let graphFault: u32 = 0;
let graphDepth: u32 = 0;
let graphOrdered: bool = true;
let graphBoundaryTrusted: bool = false;

@inline
function graphAllocate(size: usize, alignment: usize = 8): usize {
  const pointer = (graphCursor + alignment - 1) & ~(alignment - 1);
  const next = pointer + size;
  if (next < pointer || next > graphScratch) {
    graphFault = <u32>(graphCursor - graphSource);
    return 0;
  }
  graphCursor = next;
  memory.fill(pointer, 0, size);
  return pointer;
}

@inline
function graphReserveScratch(size: usize, alignment: usize = 8): usize {
  if (size > graphScratch) return 0;
  const pointer = (graphScratch - size) & ~(alignment - 1);
  if (pointer < graphCursor || pointer > graphScratch) {
    graphFault = <u32>(graphCursor - graphSource);
    return 0;
  }
  graphScratch = pointer;
  return pointer;
}

@inline
function graphFailure(pointer: usize): usize {
  graphFault = <u32>(pointer - graphSource);
  return 0;
}
`;
}

function generateInitializer(layout: ObjectLayout): string {
  return `
function initialize${layout.name}Record(record: usize): bool {
  memory.fill(record, 0, ${layout.recordSize});
  return true;
}
`;
}

interface ArrayRegistry {
  names: Map<string, string>;
  types: TypeRef[];
  unionNames: Map<string, string>;
  unionTypes: TypeRef[];
}

function collectArrays(layouts: ObjectLayout[]): ArrayRegistry {
  const names = new Map<string, string>();
  const types: TypeRef[] = [];
  const unionNames = new Map<string, string>();
  const unionTypes: TypeRef[] = [];
  const add = (type: TypeRef): void => {
    const signature = typeSignature(type);
    if (type.kind === "union") {
      if (!unionNames.has(signature)) {
        unionNames.set(signature, `GraphUnion${unionTypes.length}`);
        unionTypes.push(type);
      }
      return;
    }
    if (type.kind === "array") {
      if (!names.has(signature)) {
        names.set(signature, `GraphArray${types.length}`);
        types.push(type);
      }
      if (type.elements) for (const element of type.elements) add(element);
      else add(type.element);
    }
  };
  for (const layout of layouts) for (const field of layout.fields) add(typeOf(field));
  return { names, types, unionNames, unionTypes };
}

function parseValue(type: TypeRef, destination: string, layouts: ReadonlyMap<string, ObjectLayout>, arrays: ArrayRegistry): string {
  return emitAssemblyParseValue(type, {
    cursor: "cursor",
    end: "end",
    destination,
    document: "graphDocument",
    resolveLayout(typeName) {
      const layout = layouts.get(typeName);
      if (!layout) throw new Error(`Missing layout for nested type ${typeName}`);
      return layout;
    },
    resolveArrayHelper(arrayType) {
      const helper = arrays.names.get(typeSignature(arrayType));
      if (!helper) throw new Error(`Missing array helper for ${typeSignature(arrayType)}`);
      return helper;
    },
    resolveUnionHelper(unionType) {
      const helper = arrays.unionNames.get(typeSignature(unionType));
      if (!helper) throw new Error(`Missing union helper for ${typeSignature(unionType)}`);
      return helper;
    },
    fail(kind, pointer) {
      return kind === "object" || kind === "array"
        ? "return 0;"
        : `return graphFailure(${pointer});`;
    },
  });
}

function generateUnionDetector(type: TypeRef & { kind: "union" }, name: string): string {
  const discriminatorBytes = encoder.encode(type.discriminator);
  const discriminatorData = `${name}_DISCRIMINATOR`;
  const discriminatorInitializer = discriminatorBytes.length === 0 ? "memory.data(1)" : `memory.data<u8>([${[...discriminatorBytes].join(",")}])`;
  const discriminatorMatch = `((${bytesMatch("keyStart", "keyLength", type.discriminator)}) || matchJsonKey(keyStart, keyEnd, ${discriminatorData}, ${discriminatorBytes.length}))`;
  const variants = type.variants
    .map((variant, index) => {
      const literal = JSON.stringify(variant.discriminatorValue);
      return `${index === 0 ? "if" : "else if"} (${bytesMatch("valueStart", "valueLength", literal)}) found = ${index};`;
    })
    .join("\n        ");
  return `
const ${discriminatorData}: usize = ${discriminatorInitializer};
function detect${name}(cursor: usize, end: usize): i32 {
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end || load<u8>(cursor) != 0x7b) return -1;
  cursor++;
  let found: i32 = -1;
  while (true) {
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return -1;
    if (load<u8>(cursor) == 0x7d) return found;
    if (load<u8>(cursor) != 0x22) return -1;
    const keyStart = cursor + 1;
    const keyEnd = scanStringContent(keyStart, end);
    if (keyEnd == 0) return -1;
    const keyLength = <u32>(keyEnd - keyStart);
    cursor = skipWhitespace(keyEnd + 1, end);
    if (cursor >= end || load<u8>(cursor) != 0x3a) return -1;
    const valueStart = skipWhitespace(cursor + 1, end);
    const valueEnd = skipValue(valueStart, end);
    if (valueEnd == 0) return -1;
    if (${discriminatorMatch}) {
      const valueLength = <u32>(valueEnd - valueStart);
      found = -1;
      ${variants}
    }
    cursor = skipWhitespace(valueEnd, end);
    if (cursor >= end) return -1;
    const separator = load<u8>(cursor);
    if (separator == 0x7d) return found;
    if (separator != 0x2c) return -1;
    cursor = skipWhitespace(cursor + 1, end);
    if (cursor >= end || load<u8>(cursor) == 0x7d) return -1;
  }
}
`;
}

function generateRecordParser(layout: ObjectLayout, layouts: ReadonlyMap<string, ObjectLayout>, arrays: ArrayRegistry): string {
  const dispatch = layout.fields
    .map((field, index) => {
      const prefix = index === 0 ? "if" : "else if";
      const type = typeOf(field);
      const mask = bitmapMask(field);
      const presence = bitmapVariable("presence", field);
      const nulls = bitmapVariable("nulls", field);
      const lazy = bitmapVariable("lazy", field);
      let value = isDeferred(field) ? parseDeferred(field) : parseValue(type, `record + ${field.offset}`, layouts, arrays);
      if (field.nullable) {
        value = `const nullEnd = deserializeNull(cursor, end);
    if (nullEnd != 0) {
      ${nulls} |= ${mask};
      ${lazy} &= ~${mask};
      cursor = nullEnd;
    } else {
      ${nulls} &= ~${mask};
      ${value.replaceAll("\n", "\n      ")}
    }`;
      }
      return `    ${prefix} (${fullKeyMatch(layout, field)}) {
      ${value.replaceAll("\n", "\n      ")}
      ${presence} |= ${mask};
    }`;
    })
    .join("\n");

  const orderedAttempt = layout.fields.length === 0
    ? "  graphOrdered = false;"
    : `  const orderedEnd = parse${layout.name}RecordOrdered(cursor, end, record);
  if (orderedEnd != 0) {
    graphDepth--;
    return orderedEnd;
  }`;
  const whitespaceAttempt = layout.fields.length === 0
    ? ""
    : `  const whitespaceEnd = parse${layout.name}RecordWhitespaceOrdered(cursor, end, record);
  if (whitespaceEnd != 0) {
    graphDepth--;
    return whitespaceEnd;
  }
  graphCursor = orderedGraphCursor;
  graphScratch = orderedGraphScratch;
  graphFault = 0;
  memory.fill(record, 0, ${layout.recordSize});`;

  return `
${layout.fields.length <= 4 ? "@inline\n" : ""}function parse${layout.name}Record(cursor: usize, end: usize, record: usize): usize {
  if (graphDepth >= 256) return graphFailure(cursor);
  graphDepth++;
  const orderedGraphCursor = graphCursor;
  const orderedGraphScratch = graphScratch;
${orderedAttempt}
  return parse${layout.name}RecordSlow(cursor, end, record, orderedGraphCursor, orderedGraphScratch);
}

function parse${layout.name}RecordSlow(cursor: usize, end: usize, record: usize, orderedGraphCursor: usize, orderedGraphScratch: usize): usize {
  graphCursor = orderedGraphCursor;
  graphScratch = orderedGraphScratch;
  graphOrdered = false;
  graphFault = 0;
  memory.fill(record, 0, ${layout.recordSize});
${whitespaceAttempt}
  cursor = beginStructReader(cursor, end);
  if (cursor == 0) return graphFailure(cursor);
${bitmapDeclarations(layout, "presence", 0)}
${bitmapDeclarations(layout, "nulls", layout.nullOffset)}
${bitmapDeclarations(layout, "lazy", layout.lazyOffset)}
  while (true) {
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return graphFailure(cursor);
    if (load<u8>(cursor) == 0x7d) { cursor++; break; }
    if (load<u8>(cursor) != 0x22) return graphFailure(cursor);
    const keyStart = cursor + 1;
    const keyQuote = scanStringContent(keyStart, end);
    if (keyQuote == 0) return graphFailure(cursor);
    const keyLength = <u32>(keyQuote - keyStart);
    cursor = skipWhitespace(keyQuote + 1, end);
    if (cursor >= end || load<u8>(cursor) != 0x3a) return graphFailure(cursor);
    cursor = skipWhitespace(cursor + 1, end);
${dispatch}
    else {
      const unknownEnd = skipValue(cursor, end);
      if (unknownEnd == 0) return graphFailure(cursor);
      cursor = unknownEnd;
    }
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return graphFailure(cursor);
    const separator = load<u8>(cursor);
    if (separator == 0x2c) {
      cursor = skipWhitespace(cursor + 1, end);
      if (cursor >= end || load<u8>(cursor) == 0x7d) return graphFailure(cursor);
      continue;
    }
    if (separator == 0x7d) { cursor++; break; }
    return graphFailure(cursor);
  }
  ${bitmapStateStores(layout)}
  ${layout.lazyOffset === undefined ? "" : bitmapStores(layout, "lazy", layout.lazyOffset)}
  graphDepth--;
  return cursor;
}
`;
}

function generateOrderedRecordParser(layout: ObjectLayout, layouts: ReadonlyMap<string, ObjectLayout>, arrays: ArrayRegistry): string {
  if (layout.fields.length === 0) return "";
  const emitField = (field: FieldLayout, index: number): string => {
    const type = typeOf(field);
    const mask = bitmapMask(field);
    const presence = bitmapVariable("presence", field);
    const nulls = bitmapVariable("nulls", field);
    const lazy = bitmapVariable("lazy", field);
    const keyLength = encoder.encode(`${JSON.stringify(field.jsonName)}:`).length;
    let value = isDeferred(field) ? parseDeferred(field, true) : parseValue(type, `record + ${field.offset}`, layouts, arrays);
    if (field.nullable) {
      value = `const nullEnd = deserializeNull(cursor, end);
    if (nullEnd != 0) {
      ${nulls} |= ${mask};
      ${lazy} &= ~${mask};
      cursor = nullEnd;
    } else {
      ${nulls} &= ~${mask};
      ${value.replaceAll("\n", "\n      ")}
    }`;
    }
    const separator = index + 1 === layout.fields.length ? "0x7d" : "0x2c";
    return `  {
  if (!(${orderedKeyMatch(field)})) return 0;
  cursor += ${keyLength};
  ${value.replaceAll("\n", "\n  ")}
  ${presence} |= ${mask};
  if (cursor >= end || load<u8>(cursor) != ${separator}) return 0;
  cursor++;
  }`;
  };

  const chunkSize = layout.features.deserialize.chunkSize;
  if (chunkSize !== undefined) {
    const helpers: string[] = [];
    const calls: string[] = [];
    for (let start = 0, chunk = 0; start < layout.fields.length; start += chunkSize, chunk++) {
      const word = start >>> 5;
      const suffix = word === 0 ? "" : String(word);
      const presence = `presence${suffix}`;
      const nulls = `nulls${suffix}`;
      const lazy = `lazy${suffix}`;
      const fields = layout.fields.slice(start, start + chunkSize)
        .map((field) => emitField(field, field.index))
        .join("\n");
      const bitmapStore = layout.nullOffset === 4 && word === 0
        ? `  store<u64>(record, <u64>${presence} | (<u64>${nulls} << 32));`
        : `  store<u32>(record + ${word * 4}, ${presence});
  store<u32>(record + ${layout.nullOffset + word * 4}, ${nulls});`;
      helpers.push(`
function parse${layout.name}RecordOrderedChunk${chunk}(cursor: usize, end: usize, record: usize): usize {
  let ${presence}: u32 = 0;
  let ${nulls}: u32 = 0;
  let ${lazy}: u32 = 0;
${fields}
${bitmapStore}
  ${layout.lazyOffset === undefined ? "" : `store<u32>(record + ${layout.lazyOffset + word * 4}, ${lazy});`}
  return cursor;
}`);
      calls.push(`  const chunkEnd${chunk} = parse${layout.name}RecordOrderedChunk${chunk}(cursor, end, record);
  if (chunkEnd${chunk} == 0) return 0;
  cursor = chunkEnd${chunk};`);
    }
    return `${helpers.join("\n")}
function parse${layout.name}RecordOrdered(cursor: usize, end: usize, record: usize): usize {
  if (cursor >= end || load<u8>(cursor) != 0x7b) return 0;
  cursor++;
${calls.join("\n")}
  return cursor;
}
`;
  }

  const fields = layout.fields.map(emitField).join("\n");

  return `
${layout.fields.length <= 4 ? "@inline\n" : ""}function parse${layout.name}RecordOrdered(cursor: usize, end: usize, record: usize): usize {
  // The speculative tier is deliberately exact and minified: this is the
  // overwhelmingly common JSON.stringify output and removes three whitespace
  // scans per field. The arbitrary-order tier remains the full RFC fallback.
  if (cursor >= end || load<u8>(cursor) != 0x7b) return 0;
  cursor++;
${bitmapDeclarations(layout, "presence")}
${bitmapDeclarations(layout, "nulls")}
${bitmapDeclarations(layout, "lazy")}
${fields}
  ${bitmapStateStores(layout)}
  ${layout.lazyOffset === undefined ? "" : bitmapStores(layout, "lazy", layout.lazyOffset)}
  return cursor;
}
`;
}

function generateWhitespaceOrderedRecordParser(layout: ObjectLayout, layouts: ReadonlyMap<string, ObjectLayout>, arrays: ArrayRegistry): string {
  if (layout.fields.length === 0) return "";
  const fields = layout.fields
    .map((field) => {
      const type = typeOf(field);
      const mask = bitmapMask(field);
      const presence = bitmapVariable("presence", field);
      const nulls = bitmapVariable("nulls", field);
      const lazy = bitmapVariable("lazy", field);
      const keyLength = encoder.encode(JSON.stringify(field.jsonName)).length;
      let value = isDeferred(field) ? parseDeferred(field) : parseValue(type, `record + ${field.offset}`, layouts, arrays);
      if (field.nullable) {
        value = `const nullEnd = deserializeNull(cursor, end);
        if (nullEnd != 0) {
          ${nulls} |= ${mask};
          ${lazy} &= ~${mask};
          cursor = nullEnd;
        } else {
          ${nulls} &= ~${mask};
          ${value.replaceAll("\n", "\n          ")}
        }`;
      }
      return `  {
    let candidate = skipWhitespace(cursor, end);
    if (wrote) {
      if (candidate < end && load<u8>(candidate) == 0x2c) candidate = skipWhitespace(candidate + 1, end);
      else candidate = 0;
    }
    if (candidate != 0 && ${orderedQuotedKeyMatch(field, "candidate")}) {
      cursor = skipWhitespace(candidate + ${keyLength}, end);
      if (cursor >= end || load<u8>(cursor) != 0x3a) return 0;
      cursor = skipWhitespace(cursor + 1, end);
      ${value.replaceAll("\n", "\n      ")}
      ${presence} |= ${mask};
      wrote = true;
    }
  }`;
    })
    .join("\n");
  return `
function parse${layout.name}RecordWhitespaceOrdered(cursor: usize, end: usize, record: usize): usize {
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end || load<u8>(cursor) != 0x7b) return 0;
  cursor++;
${bitmapDeclarations(layout, "presence")}
${bitmapDeclarations(layout, "nulls")}
${bitmapDeclarations(layout, "lazy")}
  let wrote = false;
${fields}
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end || load<u8>(cursor) != 0x7d) return 0;
  ${bitmapStateStores(layout)}
  ${layout.lazyOffset === undefined ? "" : bitmapStores(layout, "lazy", layout.lazyOffset)}
  return cursor + 1;
}
`;
}

function generateArrayParser(type: TypeRef & { kind: "array" }, name: string, layouts: ReadonlyMap<string, ObjectLayout>, arrays: ArrayRegistry): string {
  const stride = type.elements ? 16 : elementStride(type.element);
  const element = parseValue(type.element, `data + <usize>index * ${stride}`, layouts, arrays).replace(/\bcursor\b/g, "elementCursor");
  if (!type.elements) {
    // Materialize once into stack-disciplined high scratch, then flatten the
    // exact number of slots into the low arena. Nested arrays recursively use
    // the space below their parent's scratch span and release it on return.
    // This gives flat contiguous output without the old full validation/count
    // scan or pathological permanent upper-bound allocations.
    const minimumWidth = type.element.kind === "boolean" ? 5 : type.element.kind === "number" ? 2 : 3;
    const elementKind = type.element.kind === "null" ? 0 : type.element.kind === "number" ? 1 : type.element.kind === "boolean" ? 2 : type.element.kind === "string" ? 3 : type.element.kind === "object" ? 4 : type.element.kind === "union" ? 7 : 5;
    return `
function parse${name}(cursor: usize, end: usize, destination: usize): usize {
  if (graphDepth >= 256) return graphFailure(cursor);
  graphDepth++;
  if (cursor >= end || load<u8>(cursor) != 0x5b) return graphFailure(cursor);
  const maximumCount = <u32>((end - cursor) / ${minimumWidth});
  const savedScratch = graphScratch;
  const temporary = graphReserveScratch(<usize>maximumCount * ${stride}, ${Math.min(stride, 8)});
  if (maximumCount != 0 && temporary == 0) return 0;

  let count: u32 = 0;
  let elementCursor = skipWhitespace(cursor + 1, end);
  if (elementCursor < end && load<u8>(elementCursor) == 0x5d) {
    elementCursor++;
  } else {
    while (true) {
      if (count >= maximumCount) return graphFailure(elementCursor);
      const index = count;
      const data = temporary;
      ${element.replaceAll("\n", "\n      ")}
      count++;
      elementCursor = skipWhitespace(elementCursor, end);
      if (elementCursor >= end) return graphFailure(elementCursor);
      const separator = load<u8>(elementCursor);
      if (separator == 0x5d) {
        elementCursor++;
        break;
      }
      if (separator != 0x2c) return graphFailure(elementCursor);
      elementCursor = skipWhitespace(elementCursor + 1, end);
    }
  }
  const header = graphAllocate(16, 8);
  const data = graphAllocate(<usize>count * ${stride}, ${Math.min(stride, 8)});
  if (header == 0 || (count != 0 && data == 0)) return 0;
  if (count != 0) memory.copy(data, temporary, <usize>count * ${stride});
  initializeArray(header, graphDocument, ${elementKind}, count, data, ${stride});
  store<u32>(destination, <u32>(header - graphDocument));
  store<u32>(destination + 4, count);
  graphScratch = savedScratch;
  graphDepth--;
  return elementCursor;
}
`;
  }
  const tupleBody = type.elements
    ?.map((tupleType, index) => {
      const parsed = parseValue(tupleType, `data + ${index * 16}`, layouts, arrays)
        .replace(/\bcursor\b/g, "elementCursor")
        .replaceAll("\n", "\n  ");
      const separator =
        index + 1 < type.elements!.length
          ? `
  elementCursor = skipWhitespace(elementCursor, end);
  if (elementCursor >= end || load<u8>(elementCursor) != 0x2c) return graphFailure(elementCursor);
  elementCursor = skipWhitespace(elementCursor + 1, end);`
          : "";
      return `  ${parsed}${separator}`;
    })
    .join("\n");
  return `
function parse${name}(cursor: usize, end: usize, destination: usize): usize {
  if (graphDepth >= 256) return graphFailure(cursor);
  graphDepth++;
  if (cursor >= end || load<u8>(cursor) != 0x5b) return graphFailure(cursor);
  const count: u32 = ${type.elements.length};
  const header = graphAllocate(16, 8);
  const data = graphAllocate(<usize>count * ${stride}, ${Math.min(stride, 8)});
  if (header == 0 || (count != 0 && data == 0)) return 0;
  initializeArray(header, graphDocument, 6, count, data, ${stride});
  store<u32>(destination, <u32>(header - graphDocument));
  store<u32>(destination + 4, count);

  let elementCursor = skipWhitespace(cursor + 1, end);
${tupleBody}
  if (elementCursor >= end || load<u8>(elementCursor) != 0x5d) return graphFailure(elementCursor);
  graphDepth--;
  return elementCursor + 1;
}
`;
}

function generateTopParser(layout: ObjectLayout, sourceFastPath: boolean): string {
  return `
@inline
function fail${layout.name}Graph(document: u32, status: u32, fault: u32, required: u32): u32 {
  releaseDocument(document);
  return failResult(status, fault, required);
}

function parse${layout.name}Core(source: u32, length: u32, trustedStringInput: bool, borrowSource: bool, output: u32, outputCapacity: u32): u32 {
  setStringInputTrusted(trustedStringInput);
  if (length > 0x0fffffff) {
    resetResult();
    return failResult(3, 0, length);
  }
${defaultDocumentFastPath(layout)}
  const recordOffset = borrowSource ? <usize>16 : align8(<usize>16 + <usize>length);
  const capacity = recordOffset + ${layout.recordSize + 1024} + <usize>length * 16;
  if (output != 0) {
    if (<usize>outputCapacity < capacity) return failResult(2, 0, <u32>capacity);
  }
  const allocated = output != 0 ? output : allocateDocument(<u32>capacity);
  if (allocated == 0) return 0;
  const document = <usize>allocated;
  const sourceOffset = borrowSource ? <usize>source - document : <usize>16;
  storeDocumentHeader(document, <u32>capacity, <u32>sourceOffset, length, <u32>recordOffset, (borrowSource ? 0x20000000 : 0) | (output != 0 ? 0x10000000 : 0));
  if (!borrowSource) memory.copy(document + sourceOffset, <usize>source, length);

  graphDocument = document;
  graphSource = borrowSource ? <usize>source : document + sourceOffset;
  graphCursor = document + recordOffset + ${layout.recordSize};
  graphLimit = document + capacity;
  graphScratch = graphLimit;
  graphFault = 0;
  graphDepth = 0;
  graphOrdered = true;
  graphBoundaryTrusted = output != 0 && trustedStringInput && borrowSource;
  const record = document + recordOffset;
  if (!initialize${layout.name}Record(record)) return fail${layout.name}Graph(allocated, 3, graphFault, <u32>capacity);
  const parsedEnd = parse${layout.name}Record(graphSource, graphSource + length, record);
  if (parsedEnd == 0) return fail${layout.name}Graph(allocated, 16, graphFault, 0);
  if (graphOrdered && inputWasMinified()) {
    if (parsedEnd != graphSource + length) return fail${layout.name}Graph(allocated, 20, <u32>(parsedEnd - graphSource), 0);
    ${sourceFastPath ? "markDocumentSourceCandidate(document);" : ""}
  } else {
    const finished = finishDocument(parsedEnd, graphSource + length);
    if (finished == 0) return fail${layout.name}Graph(allocated, 20, <u32>(parsedEnd - graphSource), 0);
  }
  const documentLength = <u32>(graphCursor - document);
  store<u32>(document, documentLength);
  if (output == 0) setResultRoot(<u32>recordOffset);
  return allocated;
}

export function parse${layout.name}(source: u32, length: u32): u32 {
  return parse${layout.name}Core(source, length, false, false, 0, 0);
}

export function parse${layout.name}Trusted(source: u32, length: u32): u32 {
  return parse${layout.name}Core(source, length, true, false, 0, 0);
}

export function parse${layout.name}Into(source: u32, length: u32, output: u32, capacity: u32): u32 {
  return parse${layout.name}Core(source, length, false, true, output, capacity);
}

export function parse${layout.name}IntoTrusted(source: u32, length: u32, output: u32, capacity: u32): u32 {
  return parse${layout.name}Core(source, length, true, true, output, capacity);
}
`;
}

function serializeValue(type: TypeRef, source: string, arrays: ArrayRegistry): string {
  return emitAssemblySerializeValue(type, {
    source,
    document: "document",
    resolveArrayHelper(arrayType) {
      const helper = arrays.names.get(typeSignature(arrayType));
      if (!helper) throw new Error(`Missing array helper for ${typeSignature(arrayType)}`);
      return helper;
    },
    fail: "return false;",
  });
}

function generateRecordSerializer(layout: ObjectLayout, arrays: ArrayRegistry): string {
  const fields = layout.fields
    .filter((field) => !field.decorators?.omit)
    .map((field) => {
      const mask = bitmapMask(field);
      const presence = bitmapVariable("presence", field);
      const nulls = bitmapVariable("nulls", field);
      const lazy = bitmapVariable("lazy", field);
      const presentCondition = `(${presence} & ${mask}) != 0${field.decorators?.omitNull ? ` && (${nulls} & ${mask}) == 0` : ""}`;
      const hasSerializableDefault = field.defaultValue !== undefined && !(field.defaultValue === null && field.decorators?.omitNull);
      const baseCondition = hasSerializableDefault ? `(${presentCondition} || (${presence} & ${mask}) == 0)` : presentCondition;
      const condition = field.decorators?.omitIfPlan
        ? `(${baseCondition}) && !(${emitOmitIfExpression(layout, field.decorators.omitIfPlan)})`
        : baseCondition;
      const value = serializeValue(typeOf(field), `record + ${field.offset}`, arrays);
      const defaultWrite = field.defaultValue === undefined
        ? ""
        : field.defaultValue === null
          ? "if (!serializeNull()) return false;"
          : packedWrites(JSON.stringify(field.defaultValue), "return false;", "      ");
      return `  if (${condition}) {
    if (!nextStructField(wrote)) return false;
${packedWrites(`${JSON.stringify(field.jsonName)}:`, "return false;", "    ")}
    if ((${presence} & ${mask}) == 0) {
      ${defaultWrite}
    } else if ((${nulls} & ${mask}) != 0) {
      if (!serializeNull()) return false;
    } else if ((${lazy} & ${mask}) != 0) {
      if (!writeRaw(<u32>(document + load<u32>(record + ${field.offset})), load<u32>(record + ${field.offset + 4}))) return false;
    } else {
      ${value.replaceAll("\n", "\n      ")}
    }
    wrote = true;
  }`;
    })
    .join("\n");
  return `
function serialize${layout.name}Record(record: usize, document: usize): bool {
${bitmapDeclarations(layout, "presence", 0, false)}
${bitmapDeclarations(layout, "nulls", layout.nullOffset, false)}
${bitmapDeclarations(layout, "lazy", layout.lazyOffset, false)}
  let wrote = false;
  if (!beginStructWriter()) return false;
${fields}
  return endStructWriter();
}
`;
}

function generateArraySerializer(type: TypeRef & { kind: "array" }, name: string, arrays: ArrayRegistry): string {
  const stride = type.elements ? 16 : elementStride(type.element);
  const value = serializeValue(type.element, `data + <usize>index * ${stride}`, arrays);
  const tupleValues = type.elements
    ?.map((tupleType, index) => {
      const encoded = serializeValue(tupleType, `data + ${index * 16}`, arrays).replaceAll("\n", "\n  ");
      return `${index === 0 ? "" : "  if (!writeByte(0x2c)) return false;\n"}  ${encoded}`;
    })
    .join("\n");
  return `
function serialize${name}(header: usize, document: usize): bool {
  const length = load<u32>(header + 4);
  const data = document + load<u32>(header + 8);
  ${!type.elements && type.element.kind === "number" ? "return serializeF64Array(data, length);" : ""}
  if (!beginArray()) return false;
  ${
    type.elements
      ? `if (length != ${type.elements.length}) return false;
${tupleValues}`
      : `for (let index: u32 = 0; index < length; index++) {
    if (!nextArrayElement(index)) return false;
    ${value.replaceAll("\n", "\n    ")}
  }`
  }
  return endArray();
}
`;
}

function generateTopSerializer(layout: ObjectLayout, sourceFastPath: boolean): string {
  return `
export function serialize${layout.name}(documentPointer: u32, output: u32, capacity: u32): u32 {
  resetResult();
  beginWriter(output, capacity);
  const document = <usize>documentPointer;
  ${sourceFastPath ? `if (documentSourceIsCanonical(document)) {
    if (!writeRaw(<u32>documentSource(document), documentSourceLength(document))) return failResult(2, 0, requiredWriterCapacity());
    return setResultOutput(output, finishWriter());
  }` : ""}
  const record = documentRoot(document);
  if (!serialize${layout.name}Record(record, document)) {
    return failResult(2, 0, requiredWriterCapacity());
  }
  const outputLength = finishWriter();
  ${sourceFastPath ? `if (documentSourceIsCandidate(document)) {
    if (documentSourceEquals(document, <usize>output, outputLength)) markDocumentSourceCanonical(document);
    else clearDocumentSourceCandidate(document);
  }` : ""}
  return setResultOutput(output, outputLength);
}
`;
}

function generateMaterializer(layout: ObjectLayout, layouts: ReadonlyMap<string, ObjectLayout>, arrays: ArrayRegistry): string {
  if (layout.lazyOffset === undefined) return "";
  const cases = layout.fields
    .filter(isDeferred)
    .map((field) => {
      const value = parseValue(typeOf(field), `record + ${field.offset}`, layouts, arrays);
      const wordOffset = bitmapWord(field) * 4;
      const mask = bitmapMask(field);
      return `    case ${field.index}: {
      const lazyWord = load<u32>(record + ${layout.lazyOffset! + wordOffset});
      if ((lazyWord & ${mask}) == 0) return arenaCursor;
      let cursor = document + <usize>load<u32>(record + ${field.offset});
      const end = cursor + <usize>load<u32>(record + ${field.offset + 4});
      ${value.replaceAll("\n", "\n      ")}
      if (cursor != end) return failResult(16, <u32>(cursor - graphSource), 0);
      store<u32>(record + ${layout.lazyOffset! + wordOffset}, lazyWord & ~${mask});
      store<u32>(document, <u32>(graphCursor - document));
      return <u32>graphCursor;
    }`;
    })
    .join("\n");
  return `
export function materialize${layout.name}Field(documentPointer: u32, recordPointer: u32, fieldIndex: u32, arenaCursor: u32, arenaLimit: u32): u32 {
  const document = <usize>documentPointer;
  const record = <usize>recordPointer;
  graphDocument = document;
  graphSource = documentSource(document);
  graphCursor = <usize>arenaCursor;
  graphLimit = <usize>arenaLimit;
  graphScratch = graphLimit;
  graphFault = 0;
  graphDepth = 0;
  graphOrdered = true;
  setStringInputTrusted(true);
  switch (fieldIndex) {
${cases}
    default: return failResult(16, fieldIndex, 0);
  }
}
`;
}

export function generateGraphAssembly(layouts: ObjectLayout[]): string {
  const layoutMap = new Map(layouts.map((layout) => [layout.name, layout]));
  const arrays = collectArrays(layouts);
  const complex = layouts.filter((layout) => layout.fields.some((field) => field.kind === "object" || field.kind === "array" || field.kind === "union"));
  const sourceFastPathMemo = new Map<string, boolean>();
  if (complex.length === 0) return "";
  return graphPrelude() + layouts.map(generateInitializer).join("\n") + layouts.map((layout) => generateOrderedRecordParser(layout, layoutMap, arrays)).join("\n") + layouts.map((layout) => generateWhitespaceOrderedRecordParser(layout, layoutMap, arrays)).join("\n") + layouts.map((layout) => generateRecordParser(layout, layoutMap, arrays)).join("\n") + arrays.unionTypes.map((type) => generateUnionDetector(type as TypeRef & { kind: "union" }, arrays.unionNames.get(typeSignature(type))!)).join("\n") + arrays.types.map((type, index) => generateArrayParser(type as TypeRef & { kind: "array" }, arrays.names.get(typeSignature(type))!, layoutMap, arrays)).join("\n") + layouts.map((layout) => generateRecordSerializer(layout, arrays)).join("\n") + arrays.types.map((type) => generateArraySerializer(type as TypeRef & { kind: "array" }, arrays.names.get(typeSignature(type))!, arrays)).join("\n") + complex.map((layout) => generateMaterializer(layout, layoutMap, arrays)).join("\n") + complex.map((layout) => {
    const sourceFastPath = graphSourcePreservesOutput(layout, layoutMap, sourceFastPathMemo);
    return generateTopParser(layout, sourceFastPath) + generateTopSerializer(layout, sourceFastPath);
  }).join("\n");
}

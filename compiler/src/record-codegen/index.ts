import { layoutObject, type FieldLayout, type ObjectLayout, type ObjectSchema, type TypeRef } from "../schema-ir.js";
import { generateGraphAssembly } from "./graph.js";
import {
  emitAssemblyParseValue,
  emitAssemblySerializeValue,
} from "../emit/assembly/index.js";
import { emitOmitIfExpression } from "../emit/shared/omit-if.js";
import { recordPolicy } from "./policy.js";

const {
  bitmapDeclarations,
  bitmapMask,
  bitmapResets,
  bitmapStateStores,
  bitmapStores,
  bitmapVariable,
  bitmapWord,
  fullKeyMatch,
  isDeferred,
  keyDataDeclarations,
  packedWrites,
  rawStores,
} = recordPolicy;

function orderedKeyMatch(field: FieldLayout): string {
  return recordPolicy.orderedKeyMatch(field, "documentEnd");
}

function orderedQuotedKeyMatch(field: FieldLayout, pointer: string): string {
  return recordPolicy.orderedQuotedKeyMatch(field, pointer, "documentEnd");
}

function bytesMatch(pointer: string, value: string): string {
  return recordPolicy.bytesMatch(pointer, value);
}

function defaultDocumentFastPath(layout: ObjectLayout): string {
  const json = recordPolicy.defaultDocumentJson(layout);
  if (json === undefined) return "";
  const length = recordPolicy.encoder.encode(json).length;
  return `
  if (output == 0 && length == ${length} && ${bytesMatch("sourceStart", json)}) {
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

function sourcePreservesOutput(layout: ObjectLayout): boolean {
  return recordPolicy.sourcePreservesOutput(layout, true);
}

function defaultInitialization(layout: ObjectLayout): {
  extraSize: number;
  presence: number;
  nulls: number;
  assembly: string;
} {
  // Defaults are immutable host/serializer constants. A zero presence bit
  // means "inherit the schema default", so parsing never constructs or copies
  // a default object graph into each document.
  return { extraSize: 0, presence: 0, nulls: 0, assembly: "" };
}

function parseField(layout: ObjectLayout, field: FieldLayout, minified = false): string {
  const destination = `record + ${field.offset}`;
  const mask = bitmapMask(field);
  const presence = bitmapVariable("presence", field);
  const nulls = bitmapVariable("nulls", field);
  const lazy = bitmapVariable("lazy", field);
  const nullable = field.nullable
    ? `
      const nullEnd${field.index} = deserializeNull(cursor, documentEnd);
      if (nullEnd${field.index} != 0) {
        ${nulls} |= ${mask};
        ${lazy} &= ~${mask};
        cursor = nullEnd${field.index};
      } else `
    : "";
  const nullableClose = field.nullable ? "" : "";

  let body: string;
  if (isDeferred(field)) {
    body = `{
        ${nulls} &= ~${mask};
        const valueStart = cursor;
        const next = ${minified ? "skipValueMinified" : "skipValue"}(cursor, documentEnd);
        if (next == 0) return fail__SCHEMA__(<u32>document, ERROR_UNEXPECTED_TOKEN, <u32>(cursor - documentSource));
        store<u32>(${destination}, <u32>(valueStart - document));
        store<u32>(${destination} + 4, <u32>(next - valueStart));
        ${lazy} |= ${mask};
        cursor = next;
      }`;
  } else {
    const type = field.type ?? ({ kind: field.kind } as TypeRef);
    const parse = emitAssemblyParseValue(type, {
      cursor: "cursor",
      end: "documentEnd",
      destination,
      document: "document",
      resolveLayout(typeName) {
        throw new Error(`Flat schema unexpectedly references object ${typeName}`);
      },
      resolveArrayHelper() {
        throw new Error("Flat schema unexpectedly references an array");
      },
      resolveUnionHelper() {
        throw new Error("Flat schema unexpectedly references a union");
      },
      fail(kind, pointer) {
        const status = kind === "number"
          ? "ERROR_INVALID_NUMBER"
          : kind === "string"
            ? "ERROR_UNTERMINATED_STRING"
            : "ERROR_UNEXPECTED_TOKEN";
        return `return fail__SCHEMA__(<u32>document, ${status}, <u32>(${pointer} - documentSource));`;
      },
    });
    const stringOpeningCheck = field.kind === "string"
      ? `if (cursor >= documentEnd || load<u8>(cursor) != 0x22) {
          return fail__SCHEMA__(<u32>document, ERROR_UNEXPECTED_TOKEN, <u32>(cursor - documentSource));
        }
        `
      : "";
    body = `{
        ${stringOpeningCheck}${parse.replaceAll("\n", "\n        ")}
      }`;
  }

  if (field.nullable) {
    body = body.replace("{", `{\n        ${nulls} &= ~${mask};`);
  }

  return `${nullable}${body}${nullableClose}
      ${presence} |= ${mask};`;
}

function orderedParse(layout: ObjectLayout): string {
  if (layout.fields.length === 0) return "";
  const chunkSize = layout.features.deserialize.chunkSize;
  if (chunkSize !== undefined) {
    const chunks = Array.from(
      { length: Math.ceil(layout.fields.length / chunkSize) },
      (_, chunk) => `  if (ordered) {
    const chunkEnd${chunk} = parse${layout.name}OrderedChunk${chunk}(cursor, documentEnd, record, document, documentSource);
    if (chunkEnd${chunk} == 1) return 0;
    if (chunkEnd${chunk} == 0) ordered = false;
    else cursor = chunkEnd${chunk};
  }`,
    ).join("\n");
    return `
  // Wide schemas use optimizer-safe monomorphic chunks. Zero means a key or
  // separator mismatch and restarts the general tier; one means the helper
  // already recorded a fatal value error and released the document.
  let ordered = cursor < documentEnd && load<u8>(cursor) == 0x7b;
  if (ordered) cursor++;
${chunks}
  if (ordered && cursor == documentEnd) {
    ${sourcePreservesOutput(layout) ? "markDocumentSourceCandidate(document);" : ""}
    if (output == 0) setResultRoot(<u32>recordOffset);
    return <u32>document;
  }
  memory.fill(record, 0, ${layout.recordSize});
  cursor = documentSource;
  ${bitmapResets(layout)}
`;
  }
  const fields = layout.fields
    .map((field, index) => {
      const separator = index + 1 === layout.fields.length ? "0x7d" : "0x2c";
      const keyLength = new TextEncoder().encode(`${JSON.stringify(field.jsonName)}:`).length;
      return `  if (ordered) {
    if (${orderedKeyMatch(field)}) {
      cursor += ${keyLength};
      ${parseField(layout, field, true).replaceAll("__SCHEMA__", layout.name).replaceAll("\n", "\n      ")}
      if (cursor < documentEnd && load<u8>(cursor) == ${separator}) cursor++;
      else ordered = false;
    } else ordered = false;
  }`;
    })
    .join("\n");
  return `
  // Canonical/ordered objects avoid string scanning and dispatch. Any key or
  // separator mismatch restarts at the fully validating arbitrary-order tier.
  let ordered = cursor < documentEnd && load<u8>(cursor) == 0x7b;
  if (ordered) cursor++;
${fields}
  if (ordered && cursor == documentEnd) {
    ${bitmapStateStores(layout)}
    ${layout.lazyOffset === undefined ? "" : bitmapStores(layout, "lazy", layout.lazyOffset)}
    ${sourcePreservesOutput(layout) ? "markDocumentSourceCandidate(document);" : ""}
    if (output == 0) setResultRoot(<u32>recordOffset);
    return <u32>document;
  }
  memory.fill(record, 0, ${layout.recordSize});
  cursor = documentSource;
  ${bitmapResets(layout)}
`;
}

function orderedParseHelpers(layout: ObjectLayout): string {
  const chunkSize = layout.features.deserialize.chunkSize;
  if (chunkSize === undefined) return "";
  const chunks: string[] = [];
  for (let start = 0, chunk = 0; start < layout.fields.length; start += chunkSize, chunk++) {
    const fields = layout.fields.slice(start, start + chunkSize);
    const word = start >>> 5;
    const presence = word === 0 ? "presence" : `presence${word}`;
    const nulls = word === 0 ? "nulls" : `nulls${word}`;
    const lazy = word === 0 ? "lazy" : `lazy${word}`;
    const body = fields
      .map((field) => {
        const separator = field.index + 1 === layout.fields.length ? "0x7d" : "0x2c";
        const keyLength = new TextEncoder().encode(`${JSON.stringify(field.jsonName)}:`).length;
        const parsed = parseField(layout, field, true)
          .replaceAll("__SCHEMA__", layout.name)
          // Preserve the conditional around one-line failure returns before
          // rewriting failures inside existing blocks.
          .replaceAll(
            /if \(([^)\n]+)\) return (fail[^;]+;)/g,
            "if ($1) { $2 return 1; }",
          )
          .replaceAll(/return (fail[^;]+;)/g, "$1 return 1;")
          .replaceAll("\n", "\n    ");
        return `  if (!(${orderedKeyMatch(field)})) return 0;
  cursor += ${keyLength};
  ${parsed}
  if (cursor >= documentEnd || load<u8>(cursor) != ${separator}) return 0;
  cursor++;`;
      })
      .join("\n");
    const lazyDeclaration = `\n  let ${lazy}: u32 = 0;`;
    const lazyStore = layout.lazyOffset === undefined ? "" : `\n  store<u32>(record + ${layout.lazyOffset + word * 4}, ${lazy});`;
    const bitmapStore = layout.nullOffset === 4 && word === 0
      ? `  store<u64>(record, <u64>${presence} | (<u64>${nulls} << 32));`
      : `  store<u32>(record + ${word * 4}, ${presence});
  store<u32>(record + ${layout.nullOffset + word * 4}, ${nulls});`;
    chunks.push(`
function parse${layout.name}OrderedChunk${chunk}(cursor: usize, documentEnd: usize, record: usize, document: usize, documentSource: usize): usize {
  let ${presence}: u32 = 0;
  let ${nulls}: u32 = 0;${lazyDeclaration}
${body}
${bitmapStore}${lazyStore}
  return cursor;
}`);
  }
  return chunks.join("\n");
}

function orderedWhitespaceParse(layout: ObjectLayout): string {
  if (layout.fields.length === 0) return "";
  const fields = layout.fields
    .map((field) => {
      const keyLength = new TextEncoder().encode(JSON.stringify(field.jsonName)).length;
      return `  if (prettyOrdered) {
    let candidate = skipWhitespace(cursor, documentEnd);
    if (prettyWrote) {
      if (candidate < documentEnd && load<u8>(candidate) == 0x2c) candidate = skipWhitespace(candidate + 1, documentEnd);
      else candidate = 0;
    }
    if (candidate != 0 && ${orderedQuotedKeyMatch(field, "candidate")}) {
      cursor = skipWhitespace(candidate + ${keyLength}, documentEnd);
      if (cursor >= documentEnd || load<u8>(cursor) != 0x3a) prettyOrdered = false;
      else {
        cursor = skipWhitespace(cursor + 1, documentEnd);
        ${parseField(layout, field).replaceAll("__SCHEMA__", layout.name).replaceAll("\n", "\n        ")}
        prettyWrote = true;
      }
    }
  }`;
    })
    .join("\n");
  return `
  // Ordered optional/pretty tier: keys remain in declaration order, while
  // absent fields and arbitrary JSON whitespace are accepted without scanning
  // or dispatching key strings.
  let prettyOrdered = cursor < documentEnd && load<u8>(cursor) == 0x7b;
  let prettyWrote = false;
  if (prettyOrdered) cursor++;
${fields}
  if (prettyOrdered) {
    cursor = skipWhitespace(cursor, documentEnd);
    if (cursor < documentEnd && load<u8>(cursor) == 0x7d) {
      cursor = finishDocument(cursor + 1, documentEnd);
      if (cursor != 0) {
        ${bitmapStateStores(layout)}
        ${layout.lazyOffset === undefined ? "" : bitmapStores(layout, "lazy", layout.lazyOffset)}
        if (output == 0) setResultRoot(<u32>recordOffset);
        return <u32>document;
      }
    }
  }
  memory.fill(record, 0, ${layout.recordSize});
  cursor = beginStructReader(documentSource, documentEnd);
  if (cursor == 0) return fail${layout.name}(<u32>document, ERROR_UNEXPECTED_TOKEN, 0);
  ${bitmapResets(layout)}
`;
}

function parseIntoTrustedFastPath(layout: ObjectLayout, retainsSource: boolean): string {
  // Unrolling pays for tiny records (the latency-sensitive Vec3/Small shapes),
  // but duplicates too much parser code across wider schemas. Keep those on
  // the shared canonical core so adding parse-into does not scale code size
  // linearly with every field in the artifact.
  if (layout.fields.length === 0 || layout.fields.length > 4 || layout.features.deserialize.chunkSize !== undefined) {
    return `return parse${layout.name}Core(source, length, true, true, output, capacity);`;
  }
  const fields = layout.fields
    .map((field, index) => {
      const separator = index + 1 === layout.fields.length ? "0x7d" : "0x2c";
      const keyLength = new TextEncoder().encode(`${JSON.stringify(field.jsonName)}:`).length;
      return `  if (!(${orderedKeyMatch(field)})) return parse${layout.name}Core(source, length, true, true, output, capacity);
  cursor += ${keyLength};
  ${parseField(layout, field, true).replaceAll("__SCHEMA__", layout.name).replaceAll("\n", "\n  ")}
  if (cursor >= documentEnd || load<u8>(cursor) != ${separator}) return parse${layout.name}Core(source, length, true, true, output, capacity);
  cursor++;`;
    })
    .join("\n");
  return `setStringInputTrusted(true);
  if (output == 0 || length > 0x0fffffff) return failResult(3, 0, length);
  const totalLength: usize = ${16 + layout.recordSize};
  if (<usize>capacity < totalLength) return failResult(2, 0, <u32>totalLength);
  const document = <usize>output;
  const documentSource = <usize>source;
  const documentEnd = documentSource + <usize>length;
  const recordOffset: usize = 16;
  const record = document + recordOffset;
  storeDocumentHeader(document, <u32>totalLength, ${retainsSource ? "<u32>(documentSource - document)" : "0"}, length, 16, ${retainsSource ? sourcePreservesOutput(layout) ? "0x70000000" : "0x30000000" : "0x10000000"});
  let cursor = documentSource;
  if (cursor >= documentEnd || load<u8>(cursor) != 0x7b) return parse${layout.name}Core(source, length, true, true, output, capacity);
  cursor++;
${bitmapDeclarations(layout, "presence")}
${bitmapDeclarations(layout, "nulls")}
${bitmapDeclarations(layout, "lazy")}
${fields}
  if (cursor != documentEnd) return parse${layout.name}Core(source, length, true, true, output, capacity);
  ${bitmapStateStores(layout)}
  ${layout.lazyOffset === undefined ? "" : bitmapStores(layout, "lazy", layout.lazyOffset)}
  return output;`;
}

function generateParser(layout: ObjectLayout): string {
  const defaults = defaultInitialization(layout);
  const retainsSource = layout.fields.some((field) => field.kind === "string" || field.kind === "host" || isDeferred(field));
  const hasOrderedTier = layout.fields.length !== 0;
  const dispatch = layout.fields
    .map((field, index) => {
      const prefix = index === 0 ? "if" : "else if";
      return `    ${prefix} (${fullKeyMatch(layout, field)}) {
      ${parseField(layout, field).replaceAll("__SCHEMA__", layout.name).replaceAll("\n", "\n      ")}
    }`;
    })
    .join("\n");

  return `
@inline
function fail${layout.name}(document: u32, status: u32, fault: u32): u32 {
  releaseDocument(document);
  return failResult(status, fault, 0);
}
${orderedParseHelpers(layout)}

function parse${layout.name}Core(source: u32, length: u32, trustedStringInput: bool, borrowSource: bool, output: u32, outputCapacity: u32): u32 {
  setStringInputTrusted(trustedStringInput);
  if (length > 0x0fffffff) {
    resetResult();
    return failResult(3, 0, length);
  }
  const sourceStart = <usize>source;
${defaultDocumentFastPath(layout)}
  const recordOffset = ${retainsSource ? "borrowSource ? <usize>16 : align8(<usize>16 + <usize>length)" : "<usize>16"};
  const totalLength = recordOffset + ${layout.recordSize + defaults.extraSize};
  if (output != 0) {
    if (<usize>outputCapacity < totalLength) return failResult(2, 0, <u32>totalLength);
  }
  const allocated = output != 0 ? output : allocateDocument(<u32>totalLength);
  if (allocated == 0) return 0;
  const document = <usize>allocated;
  const sourceOffset: usize = ${retainsSource ? "borrowSource ? sourceStart - document : <usize>16" : "0"};

  storeDocumentHeader(document, <u32>totalLength, <u32>sourceOffset, length, <u32>recordOffset, (borrowSource ? 0x20000000 : 0) | (output != 0 ? 0x10000000 : 0));
${retainsSource ? "  if (!borrowSource) memory.copy(document + sourceOffset, sourceStart, length);" : ""}

  const record = document + recordOffset;
  ${hasOrderedTier ? "" : `memory.fill(record, 0, ${layout.recordSize + defaults.extraSize});`}
${defaults.assembly}
  const documentSource = ${retainsSource ? "borrowSource ? sourceStart : document + sourceOffset" : "sourceStart"};
  const documentEnd = documentSource + <usize>length;
  let cursor = ${hasOrderedTier ? "documentSource" : "beginStructReader(documentSource, documentEnd)"};
  ${hasOrderedTier ? "" : `if (cursor == 0) return fail${layout.name}(<u32>document, ERROR_UNEXPECTED_TOKEN, 0);`}
${bitmapDeclarations(layout, "presence")}
${bitmapDeclarations(layout, "nulls")}
${bitmapDeclarations(layout, "lazy")}
${orderedParse(layout)}
${orderedWhitespaceParse(layout)}

  while (true) {
    cursor = skipWhitespace(cursor, documentEnd);
    if (cursor >= documentEnd) return fail${layout.name}(<u32>document, ERROR_UNEXPECTED_TOKEN, length);
    if (load<u8>(cursor) == 0x7d) {
      cursor++;
      break;
    }
    if (load<u8>(cursor) != 0x22) {
      return fail${layout.name}(<u32>document, ERROR_UNEXPECTED_TOKEN, <u32>(cursor - documentSource));
    }
    const keyStart = cursor + 1;
    const keyQuote = scanStringContent(keyStart, documentEnd);
    if (keyQuote == 0) return fail${layout.name}(<u32>document, ERROR_UNTERMINATED_STRING, <u32>(cursor - documentSource));
    const keyLength = <u32>(keyQuote - keyStart);
    cursor = skipWhitespace(keyQuote + 1, documentEnd);
    if (cursor >= documentEnd || load<u8>(cursor) != 0x3a) {
      return fail${layout.name}(<u32>document, ERROR_UNEXPECTED_TOKEN, <u32>(cursor - documentSource));
    }
    cursor = skipWhitespace(cursor + 1, documentEnd);

${dispatch}
    ${dispatch ? "else " : ""}{
      const next = skipValue(cursor, documentEnd);
      if (next == 0) return fail${layout.name}(<u32>document, ERROR_UNEXPECTED_TOKEN, <u32>(cursor - documentSource));
      cursor = next;
    }

    cursor = skipWhitespace(cursor, documentEnd);
    if (cursor >= documentEnd) return fail${layout.name}(<u32>document, ERROR_UNEXPECTED_TOKEN, length);
    const separator = load<u8>(cursor);
    if (separator == 0x2c) {
      cursor = skipWhitespace(cursor + 1, documentEnd);
      if (cursor >= documentEnd || load<u8>(cursor) == 0x7d) {
        return fail${layout.name}(<u32>document, ERROR_UNEXPECTED_TOKEN, <u32>(cursor - documentSource));
      }
      continue;
    }
    if (separator == 0x7d) {
      cursor++;
      break;
    }
    return fail${layout.name}(<u32>document, ERROR_UNEXPECTED_TOKEN, <u32>(cursor - documentSource));
  }

  const finished = finishDocument(cursor, documentEnd);
  if (finished == 0) return fail${layout.name}(<u32>document, ERROR_TRAILING_DATA, <u32>(cursor - documentSource));
  ${bitmapStateStores(layout)}
  ${layout.lazyOffset === undefined ? "" : bitmapStores(layout, "lazy", layout.lazyOffset)}
  if (output == 0) setResultRoot(<u32>recordOffset);
  return <u32>document;
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
  ${parseIntoTrustedFastPath(layout, retainsSource)}
}
`;
}

function serializeField(layout: ObjectLayout, field: FieldLayout): string {
  const key = `${JSON.stringify(field.jsonName)}:`;
  const fail = "return fail__SCHEMA__Writer();";
  const type = field.type ?? ({ kind: field.kind } as TypeRef);
  const value = emitAssemblySerializeValue(type, {
    source: `record + ${field.offset}`,
    document: "document",
    resolveArrayHelper() {
      throw new Error("Flat schema unexpectedly references an array");
    },
    fail,
  });

  const mask = bitmapMask(field);
  const presence = bitmapVariable("presence", field);
  const nulls = bitmapVariable("nulls", field);
  const lazy = bitmapVariable("lazy", field);
  const nullCondition = field.decorators?.omitNull ? ` && (${nulls} & ${mask}) == 0` : "";
  const hasSerializableDefault = field.defaultValue !== undefined && !(field.defaultValue === null && field.decorators?.omitNull);
  const baseCondition = hasSerializableDefault
    ? `((${presence} & ${mask}) != 0${nullCondition} || (${presence} & ${mask}) == 0)`
    : `(${presence} & ${mask}) != 0${nullCondition}`;
  const condition = field.decorators?.omitIfPlan
    ? `(${baseCondition}) && !(${emitOmitIfExpression(layout, field.decorators.omitIfPlan)})`
    : baseCondition;
  const defaultWrite = field.defaultValue === undefined
    ? ""
    : field.defaultValue === null
      ? `if (!serializeNull()) ${fail}`
      : packedWrites(JSON.stringify(field.defaultValue), fail, "      ");
  return `  if (${condition}) {
    if (!nextStructField(wroteField)) ${fail}
${packedWrites(key, fail, "    ")}
    if ((${presence} & ${mask}) == 0) {
      ${defaultWrite}
    } else if ((${nulls} & ${mask}) != 0) {
      if (!serializeNull()) ${fail}
    } else if ((${lazy} & ${mask}) != 0) {
      if (!writeRaw(<u32>(document + load<u32>(record + ${field.offset})), load<u32>(record + ${field.offset + 4}))) ${fail}
    } else {
      ${value.replaceAll("\n", "\n      ")}
    }
    wroteField = true;
  }`;
}

function generateSerializer(layout: ObjectLayout): string {
  const fields = layout.fields
    .filter((field) => !field.decorators?.omit)
    .map((field) => serializeField(layout, field))
    .join("\n")
    .replaceAll("__SCHEMA__", layout.name);
  return `
@inline
function fail${layout.name}Writer(): u32 {
  return failResult(2, 0, requiredWriterCapacity());
}

export function serialize${layout.name}(documentPointer: u32, output: u32, capacity: u32): u32 {
  resetResult();
  beginWriter(output, capacity);
  const document = <usize>documentPointer;
  ${sourcePreservesOutput(layout) ? `if (documentSourceIsCanonical(document)) {
    if (!writeRaw(<u32>documentSource(document), documentSourceLength(document))) return fail${layout.name}Writer();
    return setResultOutput(output, finishWriter());
  }` : ""}
  const record = documentRoot(document);
${bitmapDeclarations(layout, "presence", 0, false)}
${bitmapDeclarations(layout, "nulls", layout.nullOffset, false)}
${bitmapDeclarations(layout, "lazy", layout.lazyOffset, false)}
  let wroteField = false;

  if (!beginStructWriter()) return fail${layout.name}Writer();
${fields}
  if (!endStructWriter()) return fail${layout.name}Writer();
  const outputLength = finishWriter();
  ${sourcePreservesOutput(layout) ? `if (documentSourceIsCandidate(document)) {
    if (documentSourceEquals(document, <usize>output, outputLength)) markDocumentSourceCanonical(document);
    else clearDocumentSourceCandidate(document);
  }` : ""}
  return setResultOutput(output, outputLength);
}
`;
}

function generateSimpleMaterializer(layout: ObjectLayout): string {
  if (layout.lazyOffset === undefined) return "";
  const cases = layout.fields
    .filter(isDeferred)
    .map((field) => {
      const parse =
        field.kind === "number"
          ? `const parsedEnd = deserializeF64(valueStart, valueEnd, record + ${field.offset});`
          : `const parsedEnd = deserializeBoolean(valueStart, valueEnd, record + ${field.offset});`;
      const wordOffset = bitmapWord(field) * 4;
      const mask = bitmapMask(field);
      return `    case ${field.index}: {
      const lazyWord = load<u32>(record + ${layout.lazyOffset! + wordOffset});
      if ((lazyWord & ${mask}) == 0) return arenaCursor;
      const valueStart = document + <usize>load<u32>(record + ${field.offset});
      const valueEnd = valueStart + <usize>load<u32>(record + ${field.offset + 4});
      ${parse}
      if (parsedEnd != valueEnd) return failResult(ERROR_UNEXPECTED_TOKEN, <u32>(valueStart - documentSource(document)), 0);
      store<u32>(record + ${layout.lazyOffset! + wordOffset}, lazyWord & ~${mask});
      return arenaCursor;
    }`;
    })
    .join("\n");
  return `
export function materialize${layout.name}Field(documentPointer: u32, recordPointer: u32, fieldIndex: u32, arenaCursor: u32, arenaLimit: u32): u32 {
  const document = <usize>documentPointer;
  const record = <usize>recordPointer;
  switch (fieldIndex) {
${cases}
    default: return failResult(ERROR_UNEXPECTED_TOKEN, fieldIndex, 0);
  }
}
`;
}

export interface GeneratedModule {
  assembly: string;
  layouts: ObjectLayout[];
}

export interface AssemblyCodegenOptions {
  runtimeImportBase?: string;
}

export function generateAssemblyModule(schemas: ObjectSchema[], options: AssemblyCodegenOptions = {}): GeneratedModule {
  const layouts = schemas.map(layoutObject).map((layout, index): ObjectLayout => ({
    ...layout,
    abi: {
      index,
      parse: `p${index}`,
      parseTrusted: `t${index}`,
      parseInto: `pi${index}`,
      parseIntoTrusted: `pu${index}`,
      serialize: `s${index}`,
      ...(layout.lazyOffset === undefined ? {} : { materialize: `m${index}` }),
    },
  }));
  const runtimeImportBase = options.runtimeImportBase ?? "../../assembly";
  const imports = `import {
  allocateDocument,
  failResult,
  releaseDocument,
  resetResult,
  setResultRoot,
  setResultOutput,
  trimDocument,
} from "${runtimeImportBase}/runtime";
import {
  ERROR_INVALID_NUMBER,
  ERROR_TRAILING_DATA,
  ERROR_UNEXPECTED_TOKEN,
  ERROR_UNTERMINATED_STRING,
  align8,
  inputWasMinified,
  scanStringContent,
  matchJsonKey,
  setStringInputTrusted,
  skipValue,
  skipValueMinified,
  skipValueMinifiedTrusted,
  skipWhitespace,
} from "${runtimeImportBase}/deserialize/scanner";
import { initializeArray } from "${runtimeImportBase}/deserialize/array";
import { deserializeBoolean } from "${runtimeImportBase}/deserialize/boolean";
import { deserializeNull } from "${runtimeImportBase}/deserialize/null";
import { deserializeF64 } from "${runtimeImportBase}/deserialize/number";
import { deserializeString } from "${runtimeImportBase}/deserialize/string";
import { beginStruct as beginStructReader, finishDocument } from "${runtimeImportBase}/deserialize/struct";
import { clearDocumentSourceCandidate, documentRoot, documentSource, documentSourceEquals, documentSourceIsCandidate, documentSourceIsCanonical, documentSourceLength, markDocumentSourceCandidate, markDocumentSourceCanonical, storeDocumentHeader } from "${runtimeImportBase}/layout/document";
import {
  beginWriter,
  finishWriter,
  requiredWriterCapacity,
  writeByte,
  writePacked,
  writeRaw,
} from "${runtimeImportBase}/serialize/writer";
import { beginArray, endArray, nextArrayElement, serializeF64Array } from "${runtimeImportBase}/serialize/array";
import { serializeBoolean } from "${runtimeImportBase}/serialize/boolean";
import { serializeF64 } from "${runtimeImportBase}/serialize/number";
import { serializeNull } from "${runtimeImportBase}/serialize/null";
import { serializeString } from "${runtimeImportBase}/serialize/string";
import {
  beginStruct as beginStructWriter,
  endStruct as endStructWriter,
  nextStructField,
} from "${runtimeImportBase}/serialize/struct";
export {
  allocateDocument,
  commitBytes,
  echoBytes,
  initialize,
  operationScratch,
  operationScratchCapacity,
  operationScratchEnd,
  persistentHeapBase,
  persistentHeapTop,
  releaseDocument,
  resultFaultOffset,
  resultHeader,
  resultStatus,
  setHeapLimit,
} from "${runtimeImportBase}/runtime";
export { materializeDynamic, materializeDynamicTree, parseDynamic, parseDynamicEager, parseDynamicEagerTrusted, parseDynamicRetained, parseDynamicRetainedTrusted, parseDynamicTrusted } from "${runtimeImportBase}/deserialize/dynamic";
export { serializeDynamic } from "${runtimeImportBase}/serialize/dynamic";
`;
  const abiExports = layouts
    .map((layout) => `
export function ${layout.abi!.parse}(source: u32, length: u32): u32 {
  return parse${layout.name}(source, length);
}
export function ${layout.abi!.parseTrusted}(source: u32, length: u32): u32 {
  return parse${layout.name}Trusted(source, length);
}
export function ${layout.abi!.parseInto}(source: u32, length: u32, output: u32, capacity: u32): u32 {
  return parse${layout.name}Into(source, length, output, capacity);
}
export function ${layout.abi!.parseIntoTrusted}(source: u32, length: u32, output: u32, capacity: u32): u32 {
  return parse${layout.name}IntoTrusted(source, length, output, capacity);
}
export function ${layout.abi!.serialize}(document: u32, output: u32, capacity: u32): u32 {
  return serialize${layout.name}(document, output, capacity);
}
${layout.abi!.materialize ? `export function ${layout.abi!.materialize}(document: u32, record: u32, field: u32, arenaCursor: u32, arenaLimit: u32): u32 {
  return materialize${layout.name}Field(document, record, field, arenaCursor, arenaLimit);
}` : ""}`)
    .join("\n");
  return {
    assembly:
      imports +
      layouts.map(keyDataDeclarations).join("\n") + "\n" +
      layouts
        .filter((layout) => layout.fields.every((field) => field.kind !== "object" && field.kind !== "array" && field.kind !== "union"))
        .map((layout) => generateParser(layout) + generateSerializer(layout) + generateSimpleMaterializer(layout))
        .join("\n") +
      generateGraphAssembly(layouts) +
      abiExports,
    layouts,
  };
}

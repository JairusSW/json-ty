import { emitAssemblyParseValue, emitAssemblySerializeValue, } from "./emit/assembly/index.js";
import { elementStride, typeSignature } from "./emit/shared/type-plan.js";
import { emitOmitIfExpression } from "./emit/shared/omit-if.js";
const encoder = new TextEncoder();
function integerLiteral(bytes, offset, size) {
    let value = 0n;
    for (let index = 0; index < size; index++) {
        value |= BigInt(bytes[offset + index]) << BigInt(index * 8);
    }
    return `0x${value.toString(16)}`;
}
function vectorMatch(pointer, bytes, offset) {
    const lanes = [...bytes.slice(offset, offset + 16)].map((value) => value < 128 ? value : value - 256).join(", ");
    return `(ASC_FEATURE_SIMD ? !v128.any_true(v128.xor(v128.load(${pointer} + ${offset}), v128(${lanes}))) : (load<u64>(${pointer} + ${offset}) == ${integerLiteral(bytes, offset, 8)} && load<u64>(${pointer} + ${offset + 8}) == ${integerLiteral(bytes, offset + 8, 8)}))`;
}
function keyMatch(field) {
    const bytes = encoder.encode(field.jsonName);
    const checks = [`keyLength == ${bytes.length}`];
    let offset = 0;
    while (offset + 16 <= bytes.length) {
        checks.push(vectorMatch("keyStart", bytes, offset));
        offset += 16;
    }
    for (const size of [8, 4, 2, 1]) {
        while (offset + size <= bytes.length) {
            checks.push(`load<u${size * 8}>(keyStart + ${offset}) == ${integerLiteral(bytes, offset, size)}`);
            offset += size;
        }
    }
    return checks.join(" && ");
}
function keyDataName(layout, field) {
    return `KEY_${layout.name}_${field.index}`;
}
function fullKeyMatch(layout, field) {
    const length = encoder.encode(field.jsonName).length;
    return `((${keyMatch(field)}) || matchJsonKey(keyStart, keyQuote, ${keyDataName(layout, field)}, ${length}))`;
}
function orderedKeyMatch(field) {
    const bytes = encoder.encode(`${JSON.stringify(field.jsonName)}:`);
    const checks = [`cursor + ${bytes.length} <= end`];
    let offset = 0;
    while (offset + 16 <= bytes.length) {
        checks.push(vectorMatch("cursor", bytes, offset));
        offset += 16;
    }
    for (const size of [8, 4, 2, 1]) {
        while (offset + size <= bytes.length) {
            checks.push(`load<u${size * 8}>(cursor + ${offset}) == ${integerLiteral(bytes, offset, size)}`);
            offset += size;
        }
    }
    return checks.join(" && ");
}
function orderedQuotedKeyMatch(field, pointer) {
    const bytes = encoder.encode(JSON.stringify(field.jsonName));
    const checks = [`${pointer} + ${bytes.length} <= end`];
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
    return checks.join(" && ");
}
function bytesMatch(pointer, length, value) {
    const bytes = encoder.encode(value);
    const checks = [`${length} == ${bytes.length}`];
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
    return checks.join(" && ");
}
function packedWrites(value, failure, indentation) {
    const bytes = encoder.encode(value);
    const writes = [];
    for (let offset = 0; offset < bytes.length; offset += 8) {
        const length = Math.min(8, bytes.length - offset);
        writes.push(`${indentation}if (!writePacked(${integerLiteral(bytes, offset, length)}, ${length})) ${failure}`);
    }
    return writes.join("\n");
}
function typeOf(field) {
    return field.type ?? { kind: field.kind };
}
function isDeferred(field) {
    // UTF-8 strings are already source spans decoded by the host on first read.
    return field.decorators?.lazy === true && field.kind !== "string";
}
function bitmapWord(field) {
    return field.index >>> 5;
}
function bitmapMask(field) {
    return `0x${(1 << (field.index & 31) >>> 0).toString(16)}`;
}
function bitmapVariable(kind, field) {
    const word = bitmapWord(field);
    return word === 0 ? kind : `${kind}${word}`;
}
function bitmapDeclarations(layout, kind, offset, mutable = true) {
    const declaration = mutable ? "let" : "const";
    return Array.from({ length: layout.bitmapWords }, (_, word) => {
        const name = word === 0 ? kind : `${kind}${word}`;
        const value = offset === undefined ? "0" : `load<u32>(record + ${offset + word * 4})`;
        return `  ${declaration} ${name}: u32 = ${value};`;
    }).join("\n");
}
function bitmapStores(layout, kind, offset) {
    return Array.from({ length: layout.bitmapWords }, (_, word) => {
        const name = word === 0 ? kind : `${kind}${word}`;
        return `store<u32>(record + ${offset + word * 4}, ${name});`;
    }).join("\n  ");
}
function parseDeferred(field, minified = false) {
    const lazy = bitmapVariable("lazy", field);
    return `const valueStart = cursor;
    const valueEnd = ${minified ? "skipValueMinified" : "skipValue"}(cursor, end);
    if (valueEnd == 0) return graphFailure(cursor);
    store<u32>(record + ${field.offset}, <u32>(valueStart - graphDocument));
    store<u32>(record + ${field.offset + 4}, <u32>(valueEnd - valueStart));
    ${lazy} |= ${bitmapMask(field)};
    cursor = valueEnd;`;
}
function sourcePreservesOutput(layout) {
    return layout.fields.every((field) => field.defaultValue === undefined && !field.decorators?.omit && !field.decorators?.omitNull && !field.decorators?.omitIf && !field.decorators?.raw && !field.decorators?.codec && !field.hostManaged);
}
function defaultDocumentJson(layout) {
    if (!layout.features.deserialize.defaultDocument)
        return undefined;
    const fields = [];
    for (const field of layout.fields) {
        if (field.decorators?.omit || field.defaultValue === undefined || (field.defaultValue === null && field.decorators?.omitNull))
            continue;
        fields.push(`${JSON.stringify(field.jsonName)}:${JSON.stringify(field.defaultValue)}`);
    }
    return `{${fields.join(",")}}`;
}
function defaultDocumentFastPath(layout) {
    const json = defaultDocumentJson(layout);
    if (json === undefined)
        return "";
    return `  if (${bytesMatch("<usize>source", "length", json)}) {
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
function graphSourcePreservesOutput(layout, layouts, memo, visiting = new Set()) {
    const cached = memo.get(layout.name);
    if (cached !== undefined)
        return cached;
    if (!sourcePreservesOutput(layout)) {
        memo.set(layout.name, false);
        return false;
    }
    // Recursive edges do not change policy; the first visit validates every
    // field on the cycle before its result is memoized.
    if (visiting.has(layout.name))
        return true;
    visiting.add(layout.name);
    const typePreserves = (type) => {
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
        if (type.kind === "array")
            return type.elements ? type.elements.every(typePreserves) : typePreserves(type.element);
        return true;
    };
    const result = layout.fields.every((field) => typePreserves(typeOf(field)));
    visiting.delete(layout.name);
    memo.set(layout.name, result);
    return result;
}
function graphPrelude() {
    return `
let graphDocument: usize = 0;
let graphCursor: usize = 0;
let graphLimit: usize = 0;
let graphScratch: usize = 0;
let graphSource: usize = 0;
let graphFault: u32 = 0;
let graphDepth: u32 = 0;
let graphOrdered: bool = true;

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
function generateInitializer(layout) {
    return `
function initialize${layout.name}Record(record: usize): bool {
  memory.fill(record, 0, ${layout.recordSize});
  return true;
}
`;
}
function collectArrays(layouts) {
    const names = new Map();
    const types = [];
    const unionNames = new Map();
    const unionTypes = [];
    const add = (type) => {
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
            if (type.elements)
                for (const element of type.elements)
                    add(element);
            else
                add(type.element);
        }
    };
    for (const layout of layouts)
        for (const field of layout.fields)
            add(typeOf(field));
    return { names, types, unionNames, unionTypes };
}
function parseValue(type, destination, layouts, arrays) {
    return emitAssemblyParseValue(type, {
        cursor: "cursor",
        end: "end",
        destination,
        document: "graphDocument",
        resolveLayout(typeName) {
            const layout = layouts.get(typeName);
            if (!layout)
                throw new Error(`Missing layout for nested type ${typeName}`);
            return layout;
        },
        resolveArrayHelper(arrayType) {
            const helper = arrays.names.get(typeSignature(arrayType));
            if (!helper)
                throw new Error(`Missing array helper for ${typeSignature(arrayType)}`);
            return helper;
        },
        resolveUnionHelper(unionType) {
            const helper = arrays.unionNames.get(typeSignature(unionType));
            if (!helper)
                throw new Error(`Missing union helper for ${typeSignature(unionType)}`);
            return helper;
        },
        fail(kind, pointer) {
            return kind === "object" || kind === "array"
                ? "return 0;"
                : `return graphFailure(${pointer});`;
        },
    });
}
function generateUnionDetector(type, name) {
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
    cursor++;
  }
}
`;
}
function generateRecordParser(layout, layouts, arrays) {
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
    // Defaults may allocate arena strings while initializing the record. A
    // failed speculative parse cannot roll those allocations back without also
    // restoring the initialized slots, so keep those schemas on the generic
    // path until they get a template-record specialization.
    const ordered = layout.fields.length === 0
        ? "  graphOrdered = false;"
        : `  const orderedGraphCursor = graphCursor;
  const orderedGraphScratch = graphScratch;
  const orderedEnd = parse${layout.name}RecordOrdered(cursor, end, record);
  if (orderedEnd != 0) {
    graphDepth--;
    return orderedEnd;
  }
  graphCursor = orderedGraphCursor;
  graphScratch = orderedGraphScratch;
  graphOrdered = false;
  graphFault = 0;
  memory.fill(record, 0, ${layout.recordSize});
  const whitespaceEnd = parse${layout.name}RecordWhitespaceOrdered(cursor, end, record);
  if (whitespaceEnd != 0) {
    graphDepth--;
    return whitespaceEnd;
  }
  graphCursor = orderedGraphCursor;
  graphScratch = orderedGraphScratch;
  graphFault = 0;
  memory.fill(record, 0, ${layout.recordSize});`;
    return `
function parse${layout.name}Record(cursor: usize, end: usize, record: usize): usize {
  if (graphDepth >= 256) return graphFailure(cursor);
  graphDepth++;
${ordered}
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
    if (separator == 0x2c) { cursor++; continue; }
    if (separator == 0x7d) { cursor++; break; }
    return graphFailure(cursor);
  }
  ${bitmapStores(layout, "presence", 0)}
  ${bitmapStores(layout, "nulls", layout.nullOffset)}
  ${layout.lazyOffset === undefined ? "" : bitmapStores(layout, "lazy", layout.lazyOffset)}
  graphDepth--;
  return cursor;
}
`;
}
function generateOrderedRecordParser(layout, layouts, arrays) {
    if (layout.fields.length === 0)
        return "";
    const fields = layout.fields
        .map((field, index) => {
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
    })
        .join("\n");
    return `
function parse${layout.name}RecordOrdered(cursor: usize, end: usize, record: usize): usize {
  // The speculative tier is deliberately exact and minified: this is the
  // overwhelmingly common JSON.stringify output and removes three whitespace
  // scans per field. The arbitrary-order tier remains the full RFC fallback.
  if (cursor >= end || load<u8>(cursor) != 0x7b) return 0;
  cursor++;
${bitmapDeclarations(layout, "presence")}
${bitmapDeclarations(layout, "nulls")}
${bitmapDeclarations(layout, "lazy")}
${fields}
  ${bitmapStores(layout, "presence", 0)}
  ${bitmapStores(layout, "nulls", layout.nullOffset)}
  ${layout.lazyOffset === undefined ? "" : bitmapStores(layout, "lazy", layout.lazyOffset)}
  return cursor;
}
`;
}
function generateWhitespaceOrderedRecordParser(layout, layouts, arrays) {
    if (layout.fields.length === 0)
        return "";
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
  ${bitmapStores(layout, "presence", 0)}
  ${bitmapStores(layout, "nulls", layout.nullOffset)}
  ${layout.lazyOffset === undefined ? "" : bitmapStores(layout, "lazy", layout.lazyOffset)}
  return cursor + 1;
}
`;
}
function generateArrayParser(type, name, layouts, arrays) {
    const stride = type.elements ? 16 : elementStride(type.element);
    const element = parseValue(type.element, `data + <usize>index * ${stride}`, layouts, arrays).replace(/\bcursor\b/g, "elementCursor");
    if (!type.elements) {
        // Materialize once into stack-disciplined high scratch, then flatten the
        // exact number of slots into the low arena. Nested arrays recursively use
        // the space below their parent's scratch span and release it on return.
        // This gives flat contiguous output without the old full validation/count
        // scan or pathological permanent upper-bound allocations.
        const minimumWidth = type.element.kind === "boolean" ? 5 : type.element.kind === "number" ? 2 : 3;
        const elementKind = type.element.kind === "number" ? 1 : type.element.kind === "boolean" ? 2 : type.element.kind === "string" ? 3 : type.element.kind === "object" ? 4 : type.element.kind === "union" ? 7 : 5;
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
        const separator = index + 1 < type.elements.length
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
function generateTopParser(layout, sourceFastPath) {
    return `
@inline
function fail${layout.name}Graph(document: u32, status: u32, fault: u32, required: u32): u32 {
  releaseDocument(document);
  return failResult(status, fault, required);
}

function parse${layout.name}Core(source: u32, length: u32, trustedStringInput: bool): u32 {
  setStringInputTrusted(trustedStringInput);
  if (length > 0x0fffffff) {
    resetResult();
    return failResult(3, 0, length);
  }
${defaultDocumentFastPath(layout)}
  const sourceOffset: usize = 16;
  const recordOffset = align8(sourceOffset + <usize>length);
  const capacity = recordOffset + ${layout.recordSize + 1024} + <usize>length * 16;
  const allocated = allocateDocument(<u32>capacity);
  if (allocated == 0) return 0;
  const document = <usize>allocated;
  storeDocumentHeader(document, <u32>capacity, <u32>sourceOffset, length, <u32>recordOffset);
  memory.copy(document + sourceOffset, <usize>source, length);

  graphDocument = document;
  graphSource = document + sourceOffset;
  graphCursor = document + recordOffset + ${layout.recordSize};
  graphLimit = document + capacity;
  graphScratch = graphLimit;
  graphFault = 0;
  graphDepth = 0;
  graphOrdered = true;
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
  store<u32>(document, <u32>(graphCursor - document));
  setResultRoot(<u32>recordOffset);
  return allocated;
}

export function parse${layout.name}(source: u32, length: u32): u32 {
  return parse${layout.name}Core(source, length, false);
}

export function parse${layout.name}Trusted(source: u32, length: u32): u32 {
  return parse${layout.name}Core(source, length, true);
}
`;
}
function serializeValue(type, source, arrays) {
    return emitAssemblySerializeValue(type, {
        source,
        document: "document",
        resolveArrayHelper(arrayType) {
            const helper = arrays.names.get(typeSignature(arrayType));
            if (!helper)
                throw new Error(`Missing array helper for ${typeSignature(arrayType)}`);
            return helper;
        },
        fail: "return false;",
    });
}
function generateRecordSerializer(layout, arrays) {
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
function generateArraySerializer(type, name, arrays) {
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
  ${type.elements
        ? `if (length != ${type.elements.length}) return false;
${tupleValues}`
        : `for (let index: u32 = 0; index < length; index++) {
    if (!nextArrayElement(index)) return false;
    ${value.replaceAll("\n", "\n    ")}
  }`}
  return endArray();
}
`;
}
function generateTopSerializer(layout, sourceFastPath) {
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
function generateMaterializer(layout, layouts, arrays) {
    if (layout.lazyOffset === undefined)
        return "";
    const cases = layout.fields
        .filter(isDeferred)
        .map((field) => {
        const value = parseValue(typeOf(field), `record + ${field.offset}`, layouts, arrays);
        const wordOffset = bitmapWord(field) * 4;
        const mask = bitmapMask(field);
        return `    case ${field.index}: {
      const lazyWord = load<u32>(record + ${layout.lazyOffset + wordOffset});
      if ((lazyWord & ${mask}) == 0) return arenaCursor;
      let cursor = document + <usize>load<u32>(record + ${field.offset});
      const end = cursor + <usize>load<u32>(record + ${field.offset + 4});
      ${value.replaceAll("\n", "\n      ")}
      if (cursor != end) return failResult(16, <u32>(cursor - graphSource), 0);
      store<u32>(record + ${layout.lazyOffset + wordOffset}, lazyWord & ~${mask});
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
export function generateComplexAssembly(layouts) {
    const layoutMap = new Map(layouts.map((layout) => [layout.name, layout]));
    const arrays = collectArrays(layouts);
    const complex = layouts.filter((layout) => layout.fields.some((field) => field.kind === "object" || field.kind === "array" || field.kind === "union"));
    const sourceFastPathMemo = new Map();
    if (complex.length === 0)
        return "";
    return graphPrelude() + layouts.map(generateInitializer).join("\n") + layouts.map((layout) => generateOrderedRecordParser(layout, layoutMap, arrays)).join("\n") + layouts.map((layout) => generateWhitespaceOrderedRecordParser(layout, layoutMap, arrays)).join("\n") + layouts.map((layout) => generateRecordParser(layout, layoutMap, arrays)).join("\n") + arrays.unionTypes.map((type) => generateUnionDetector(type, arrays.unionNames.get(typeSignature(type)))).join("\n") + arrays.types.map((type, index) => generateArrayParser(type, arrays.names.get(typeSignature(type)), layoutMap, arrays)).join("\n") + layouts.map((layout) => generateRecordSerializer(layout, arrays)).join("\n") + arrays.types.map((type) => generateArraySerializer(type, arrays.names.get(typeSignature(type)), arrays)).join("\n") + complex.map((layout) => generateMaterializer(layout, layoutMap, arrays)).join("\n") + complex.map((layout) => {
        const sourceFastPath = graphSourcePreservesOutput(layout, layoutMap, sourceFastPathMemo);
        return generateTopParser(layout, sourceFastPath) + generateTopSerializer(layout, sourceFastPath);
    }).join("\n");
}

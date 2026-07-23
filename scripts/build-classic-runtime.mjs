import { prepareArtifactCompilation } from "../dist/compiler/index.js";
import { classicSchemas } from "../bench/classic/schemas.mjs";

const benchmarkAssembly = `
import { parseDynamicTrusted as parseDynamicBenchmarkTrusted } from "../../assembly/deserialize/dynamic";
import { deserializeF64 as deserializeClassicProjectionF64 } from "../../assembly/deserialize/number";
import { serializeDynamic as serializeDynamicBenchmark } from "../../assembly/serialize/dynamic";
import { resultHeader as classicResultHeader, resultStatus as classicResultStatus } from "../../assembly/runtime";

let classicBenchmarkSink: u32 = 0x9e3779b9;
let classicProjectionSum: f64 = 0;
let classicDynamicDocument: u32 = 0;
const classicProjectionNumberScratch: usize = memory.data(8);

@inline
function consumeClassicDocument(document: u32, source: u32): void {
  classicBenchmarkSink = (
    classicBenchmarkSink * 1664525 +
    load<u32>(document) +
    load<u32>(document + 8) +
    load<u32>(document + 12) +
    load<u8>(source) +
    source
  ) | 0;
}

export function benchmarkPoemArrayIntoTrusted(source: u32, stride: u32, length: u32, output: u32, capacity: u32, iterations: u32): u32 {
  for (let index: u32 = 0; index < iterations; index++) {
    const input = source + (index & 3) * stride;
    const document = parsePoemArrayIntoTrusted(input, length, output, capacity);
    if (document != output) return 0;
    consumeClassicDocument(document, input);
  }
  return classicBenchmarkSink | 1;
}

export function benchmarkPoemArrayOwnedTrusted(source: u32, stride: u32, length: u32, iterations: u32): u32 {
  for (let index: u32 = 0; index < iterations; index++) {
    const input = source + (index & 3) * stride;
    const document = parsePoemArrayTrusted(input, length);
    if (document == 0) return 0;
    consumeClassicDocument(document, input);
    if (releaseDocument(document) != 0) return 0;
  }
  return classicBenchmarkSink | 1;
}

export function benchmarkCanadaIntoTrusted(source: u32, stride: u32, length: u32, output: u32, capacity: u32, iterations: u32): u32 {
  for (let index: u32 = 0; index < iterations; index++) {
    const input = source + (index & 3) * stride;
    const document = parseCanadaIntoTrusted(input, length, output, capacity);
    if (document != output) return 0;
    consumeClassicDocument(document, input);
  }
  return classicBenchmarkSink | 1;
}

export function benchmarkCanadaOwnedTrusted(source: u32, stride: u32, length: u32, iterations: u32): u32 {
  for (let index: u32 = 0; index < iterations; index++) {
    const input = source + (index & 3) * stride;
    const document = parseCanadaTrusted(input, length);
    if (document == 0) return 0;
    consumeClassicDocument(document, input);
    if (releaseDocument(document) != 0) return 0;
  }
  return classicBenchmarkSink | 1;
}

export function benchmarkCanadaLazyIntoTrusted(source: u32, stride: u32, length: u32, output: u32, capacity: u32, iterations: u32): u32 {
  for (let index: u32 = 0; index < iterations; index++) {
    const input = source + (index & 3) * stride;
    const document = parseCanadaLazyIntoTrusted(input, length, output, capacity);
    if (document != output) return 0;
    consumeClassicDocument(document, input);
  }
  return classicBenchmarkSink | 1;
}

export function benchmarkCanadaLazyOwnedTrusted(source: u32, stride: u32, length: u32, iterations: u32): u32 {
  for (let index: u32 = 0; index < iterations; index++) {
    const input = source + (index & 3) * stride;
    const document = parseCanadaLazyTrusted(input, length);
    if (document == 0) return 0;
    consumeClassicDocument(document, input);
    if (releaseDocument(document) != 0) return 0;
  }
  return classicBenchmarkSink | 1;
}

export function benchmarkDynamicOwnedTrusted(source: u32, stride: u32, length: u32, iterations: u32): u32 {
  for (let index: u32 = 0; index < iterations; index++) {
    const input = source + (index & 3) * stride;
    const document = parseDynamicBenchmarkTrusted(input, length);
    if (document == 0) return 0;
    consumeClassicDocument(document, input);
    if (releaseDocument(document) != 0) return 0;
  }
  return classicBenchmarkSink | 1;
}

export function benchmarkRawValidate(source: u32, stride: u32, length: u32, iterations: u32): u32 {
  setStringInputTrusted(true);
  for (let index: u32 = 0; index < iterations; index++) {
    const input = source + (index & 3) * stride;
    const end = input + length;
    const next = skipValueMinifiedTrusted(input, end);
    if (next == 0 || skipWhitespace(next, end) != end) return 0;
    classicBenchmarkSink = (
      classicBenchmarkSink * 1664525 +
      length +
      load<u8>(input) +
      load<u8>(end - 1) +
      input
    ) | 0;
  }
  return classicBenchmarkSink | 1;
}

@inline
function rawKind(token: u8): u32 {
  if (token == 0x6e) return 0;
  if (token == 0x74 || token == 0x66) return 1;
  if (token == 0x22) return 3;
  if (token == 0x5b) return 4;
  if (token == 0x7b) return 5;
  return 2;
}

function projectRootKinds(input: usize, end: usize): u32 {
  let cursor = skipWhitespace(input, end);
  if (cursor >= end || load<u8>(cursor) != 0x7b) return 0xffffffff;
  cursor = skipWhitespace(cursor + 1, end);
  if (cursor < end && load<u8>(cursor) == 0x7d) return 0;
  let projection: u32 = 0;
  while (cursor < end) {
    if (load<u8>(cursor) != 0x22) return 0xffffffff;
    const keyEnd = scanStringContent(cursor + 1, end);
    if (keyEnd == 0) return 0xffffffff;
    cursor = skipWhitespace(keyEnd + 1, end);
    if (cursor >= end || load<u8>(cursor) != 0x3a) return 0xffffffff;
    cursor = skipWhitespace(cursor + 1, end);
    if (cursor >= end) return 0xffffffff;
    projection += rawKind(load<u8>(cursor));
    cursor = skipValueMinifiedTrusted(cursor, end);
    if (cursor == 0) return 0xffffffff;
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return 0xffffffff;
    const separator = load<u8>(cursor);
    if (separator == 0x7d) return projection;
    if (separator != 0x2c) return 0xffffffff;
    cursor = skipWhitespace(cursor + 1, end);
  }
  return 0xffffffff;
}

export function projectRootKindsOnceTrusted(source: u32, length: u32): u32 {
  setStringInputTrusted(true);
  return projectRootKinds(source, source + length);
}

export function benchmarkRootKindsTrusted(source: u32, stride: u32, length: u32, iterations: u32): u32 {
  setStringInputTrusted(true);
  for (let index: u32 = 0; index < iterations; index++) {
    const input = source + (index & 3) * stride;
    const projection = projectRootKinds(input, input + length);
    if (projection == 0xffffffff) return 0;
    classicBenchmarkSink = classicBenchmarkSink * 1664525 + projection + input;
  }
  return classicBenchmarkSink | 1;
}

@inline
function projectStringLength(cursor: usize, end: usize): usize {
  if (cursor >= end || load<u8>(cursor) != 0x22) return 0;
  const quote = scanStringContent(cursor + 1, end);
  if (quote == 0) return 0;
  classicProjectionSum += <f64>(quote - cursor - 1);
  return quote + 1;
}

@inline
function projectNumber(cursor: usize, end: usize): usize {
  const next = deserializeClassicProjectionF64(cursor, end, classicProjectionNumberScratch);
  if (next != 0) classicProjectionSum += load<f64>(classicProjectionNumberScratch);
  return next;
}

@inline
function lottieKey(key: usize, length: usize): u32 {
  if (length == 1) {
    const byte = load<u8>(key);
    if (byte == 0x76) return 1;
    if (byte == 0x77) return 2;
    if (byte == 0x68) return 3;
  }
  if (length == 2) {
    const word = load<u16>(key);
    if (word == 0x6d6e) return 4;
    if (word == 0x7974) return 5;
    if (word == 0x7069) return 6;
    if (word == 0x706f) return 7;
    if (word == 0x736b) return 8;
    if (word == 0x6469) return 9;
    if (word == 0x7266) return 10;
  }
  if (length == 6) {
    const prefix = load<u32>(key);
    const suffix = load<u16>(key + 4);
    if (prefix == 0x70616873 && suffix == 0x7365) return 11;
    if (prefix == 0x6579616c && suffix == 0x7372) return 12;
    if (prefix == 0x65737361 && suffix == 0x7374) return 13;
  }
  return 0;
}

function projectLottieLayer(cursor: usize, end: usize): usize {
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end || load<u8>(cursor) != 0x7b) return 0;
  cursor = skipWhitespace(cursor + 1, end);
  if (cursor < end && load<u8>(cursor) == 0x7d) return cursor + 1;
  while (cursor < end) {
    if (load<u8>(cursor) != 0x22) return 0;
    const key = cursor + 1;
    const keyEnd = scanStringContent(key, end);
    if (keyEnd == 0) return 0;
    const kind = lottieKey(key, keyEnd - key);
    cursor = skipWhitespace(keyEnd + 1, end);
    if (cursor >= end || load<u8>(cursor) != 0x3a) return 0;
    cursor = skipWhitespace(cursor + 1, end);
    if (kind == 4) cursor = projectStringLength(cursor, end);
    else if (kind == 5 || kind == 6 || kind == 7) cursor = projectNumber(cursor, end);
    else {
      if (kind == 8 || kind == 11) classicProjectionSum += <f64>rawKind(load<u8>(cursor));
      cursor = skipValueMinifiedTrusted(cursor, end);
    }
    if (cursor == 0) return 0;
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return 0;
    const separator = load<u8>(cursor);
    if (separator == 0x7d) return cursor + 1;
    if (separator != 0x2c) return 0;
    cursor = skipWhitespace(cursor + 1, end);
  }
  return 0;
}

function projectLottieLayers(cursor: usize, end: usize): usize {
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end || load<u8>(cursor) != 0x5b) return 0;
  cursor = skipWhitespace(cursor + 1, end);
  if (cursor < end && load<u8>(cursor) == 0x5d) return cursor + 1;
  while (cursor < end) {
    cursor = projectLottieLayer(cursor, end);
    if (cursor == 0) return 0;
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return 0;
    const separator = load<u8>(cursor);
    if (separator == 0x5d) return cursor + 1;
    if (separator != 0x2c) return 0;
    cursor = skipWhitespace(cursor + 1, end);
  }
  return 0;
}

function projectLottieAsset(cursor: usize, end: usize): usize {
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end || load<u8>(cursor) != 0x7b) return 0;
  cursor = skipWhitespace(cursor + 1, end);
  if (cursor < end && load<u8>(cursor) == 0x7d) return cursor + 1;
  while (cursor < end) {
    if (load<u8>(cursor) != 0x22) return 0;
    const key = cursor + 1;
    const keyEnd = scanStringContent(key, end);
    if (keyEnd == 0) return 0;
    const kind = lottieKey(key, keyEnd - key);
    cursor = skipWhitespace(keyEnd + 1, end);
    if (cursor >= end || load<u8>(cursor) != 0x3a) return 0;
    cursor = skipWhitespace(cursor + 1, end);
    if (kind == 9) cursor = projectStringLength(cursor, end);
    else if (kind == 12) cursor = projectLottieLayers(cursor, end);
    else cursor = skipValueMinifiedTrusted(cursor, end);
    if (cursor == 0) return 0;
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return 0;
    const separator = load<u8>(cursor);
    if (separator == 0x7d) return cursor + 1;
    if (separator != 0x2c) return 0;
    cursor = skipWhitespace(cursor + 1, end);
  }
  return 0;
}

function projectLottieAssets(cursor: usize, end: usize): usize {
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end || load<u8>(cursor) != 0x5b) return 0;
  cursor = skipWhitespace(cursor + 1, end);
  if (cursor < end && load<u8>(cursor) == 0x5d) return cursor + 1;
  while (cursor < end) {
    cursor = projectLottieAsset(cursor, end);
    if (cursor == 0) return 0;
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return 0;
    const separator = load<u8>(cursor);
    if (separator == 0x5d) return cursor + 1;
    if (separator != 0x2c) return 0;
    cursor = skipWhitespace(cursor + 1, end);
  }
  return 0;
}

function projectLottie(input: usize, end: usize): bool {
  classicProjectionSum = 0;
  let cursor = skipWhitespace(input, end);
  if (cursor >= end || load<u8>(cursor) != 0x7b) return false;
  cursor = skipWhitespace(cursor + 1, end);
  while (cursor < end && load<u8>(cursor) != 0x7d) {
    if (load<u8>(cursor) != 0x22) return false;
    const key = cursor + 1;
    const keyEnd = scanStringContent(key, end);
    if (keyEnd == 0) return false;
    const kind = lottieKey(key, keyEnd - key);
    cursor = skipWhitespace(keyEnd + 1, end);
    if (cursor >= end || load<u8>(cursor) != 0x3a) return false;
    cursor = skipWhitespace(cursor + 1, end);
    if (kind == 1) cursor = projectStringLength(cursor, end);
    else if (kind == 2 || kind == 3 || kind == 7 || kind == 10) cursor = projectNumber(cursor, end);
    else if (kind == 12) cursor = projectLottieLayers(cursor, end);
    else if (kind == 13) cursor = projectLottieAssets(cursor, end);
    else cursor = skipValueMinifiedTrusted(cursor, end);
    if (cursor == 0) return false;
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return false;
    const separator = load<u8>(cursor);
    if (separator == 0x7d) break;
    if (separator != 0x2c) return false;
    cursor = skipWhitespace(cursor + 1, end);
  }
  return cursor < end && load<u8>(cursor) == 0x7d && skipWhitespace(cursor + 1, end) == end;
}

export function projectLottieOnceTrusted(source: u32, length: u32): f64 {
  setStringInputTrusted(true);
  return projectLottie(source, source + length) ? classicProjectionSum : NaN;
}

export function benchmarkLottieProjectionTrusted(source: u32, stride: u32, length: u32, iterations: u32): u32 {
  setStringInputTrusted(true);
  for (let index: u32 = 0; index < iterations; index++) {
    const input = source + (index & 3) * stride;
    if (!projectLottie(input, input + length)) return 0;
    const bits = reinterpret<u64>(classicProjectionSum);
    classicBenchmarkSink = classicBenchmarkSink * 1664525 + <u32>bits + <u32>(bits >> 32) + input;
  }
  return classicBenchmarkSink | 1;
}

@inline
function rawKeyEquals(key: usize, length: usize, expected: string): bool {
  if (length != expected.length) return false;
  for (let index: usize = 0; index < length; index++) {
    if (load<u8>(key + index) != expected.charCodeAt(index)) return false;
  }
  return true;
}

@inline
function projectNullableString(cursor: usize, end: usize): usize {
  return cursor < end && load<u8>(cursor) == 0x22
    ? projectStringLength(cursor, end)
    : skipValueMinifiedTrusted(cursor, end);
}

function projectCitmRecord(cursor: usize, end: usize, event: bool): usize {
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end || load<u8>(cursor) != 0x7b) return 0;
  cursor = skipWhitespace(cursor + 1, end);
  if (cursor < end && load<u8>(cursor) == 0x7d) return cursor + 1;
  while (cursor < end) {
    if (load<u8>(cursor) != 0x22) return 0;
    const key = cursor + 1;
    const keyEnd = scanStringContent(key, end);
    if (keyEnd == 0) return 0;
    const keyLength = keyEnd - key;
    cursor = skipWhitespace(keyEnd + 1, end);
    if (cursor >= end || load<u8>(cursor) != 0x3a) return 0;
    cursor = skipWhitespace(cursor + 1, end);
    if (rawKeyEquals(key, keyLength, "id") || (!event && (rawKeyEquals(key, keyLength, "eventId") || rawKeyEquals(key, keyLength, "start")))) {
      cursor = projectNumber(cursor, end);
    } else if (rawKeyEquals(key, keyLength, "name") || (event && rawKeyEquals(key, keyLength, "subjectCode"))) {
      cursor = projectNullableString(cursor, end);
    } else if (!event && rawKeyEquals(key, keyLength, "venueCode")) {
      cursor = projectStringLength(cursor, end);
    } else {
      cursor = skipValueMinifiedTrusted(cursor, end);
    }
    if (cursor == 0) return 0;
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return 0;
    const separator = load<u8>(cursor);
    if (separator == 0x7d) return cursor + 1;
    if (separator != 0x2c) return 0;
    cursor = skipWhitespace(cursor + 1, end);
  }
  return 0;
}

function projectCitmPerformances(cursor: usize, end: usize): usize {
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end || load<u8>(cursor) != 0x5b) return 0;
  cursor = skipWhitespace(cursor + 1, end);
  if (cursor < end && load<u8>(cursor) == 0x5d) return cursor + 1;
  while (cursor < end) {
    cursor = projectCitmRecord(cursor, end, false);
    if (cursor == 0) return 0;
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return 0;
    const separator = load<u8>(cursor);
    if (separator == 0x5d) return cursor + 1;
    if (separator != 0x2c) return 0;
    cursor = skipWhitespace(cursor + 1, end);
  }
  return 0;
}

function projectCitmEvents(cursor: usize, end: usize): usize {
  cursor = skipWhitespace(cursor, end);
  if (cursor >= end || load<u8>(cursor) != 0x7b) return 0;
  cursor = skipWhitespace(cursor + 1, end);
  if (cursor < end && load<u8>(cursor) == 0x7d) return cursor + 1;
  let count: u32 = 0;
  while (cursor < end) {
    if (load<u8>(cursor) != 0x22) return 0;
    const keyEnd = scanStringContent(cursor + 1, end);
    if (keyEnd == 0) return 0;
    cursor = skipWhitespace(keyEnd + 1, end);
    if (cursor >= end || load<u8>(cursor) != 0x3a) return 0;
    cursor = skipWhitespace(cursor + 1, end);
    cursor = count < 8
      ? projectCitmRecord(cursor, end, true)
      : skipValueMinifiedTrusted(cursor, end);
    if (cursor == 0) return 0;
    count++;
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return 0;
    const separator = load<u8>(cursor);
    if (separator == 0x7d) return cursor + 1;
    if (separator != 0x2c) return 0;
    cursor = skipWhitespace(cursor + 1, end);
  }
  return 0;
}

function projectCitm(input: usize, end: usize): bool {
  classicProjectionSum = 0;
  let cursor = skipWhitespace(input, end);
  if (cursor >= end || load<u8>(cursor) != 0x7b) return false;
  cursor = skipWhitespace(cursor + 1, end);
  while (cursor < end && load<u8>(cursor) != 0x7d) {
    if (load<u8>(cursor) != 0x22) return false;
    const key = cursor + 1;
    const keyEnd = scanStringContent(key, end);
    if (keyEnd == 0) return false;
    const keyLength = keyEnd - key;
    cursor = skipWhitespace(keyEnd + 1, end);
    if (cursor >= end || load<u8>(cursor) != 0x3a) return false;
    cursor = skipWhitespace(cursor + 1, end);
    if (rawKeyEquals(key, keyLength, "performances")) cursor = projectCitmPerformances(cursor, end);
    else if (rawKeyEquals(key, keyLength, "events")) cursor = projectCitmEvents(cursor, end);
    else cursor = skipValueMinifiedTrusted(cursor, end);
    if (cursor == 0) return false;
    cursor = skipWhitespace(cursor, end);
    if (cursor >= end) return false;
    const separator = load<u8>(cursor);
    if (separator == 0x7d) break;
    if (separator != 0x2c) return false;
    cursor = skipWhitespace(cursor + 1, end);
  }
  return cursor < end && load<u8>(cursor) == 0x7d && skipWhitespace(cursor + 1, end) == end;
}

export function projectCitmOnceTrusted(source: u32, length: u32): f64 {
  setStringInputTrusted(true);
  return projectCitm(source, source + length) ? classicProjectionSum : NaN;
}

export function benchmarkCitmProjectionTrusted(source: u32, stride: u32, length: u32, iterations: u32): u32 {
  setStringInputTrusted(true);
  for (let index: u32 = 0; index < iterations; index++) {
    const input = source + (index & 3) * stride;
    if (!projectCitm(input, input + length)) return 0;
    const bits = reinterpret<u64>(classicProjectionSum);
    classicBenchmarkSink = classicBenchmarkSink * 1664525 + <u32>bits + <u32>(bits >> 32) + input;
  }
  return classicBenchmarkSink | 1;
}

export function prepareClassicDynamicSerialize(source: u32, length: u32): u32 {
  if (classicDynamicDocument != 0) {
    if (releaseDocument(classicDynamicDocument) != 0) return 0;
    classicDynamicDocument = 0;
  }
  classicDynamicDocument = parseDynamicBenchmarkTrusted(source, length);
  return classicDynamicDocument;
}

export function benchmarkClassicDynamicSerialize(output: u32, capacity: u32, iterations: u32): u32 {
  if (classicDynamicDocument == 0) return 0;
  for (let index: u32 = 0; index < iterations; index++) {
    serializeDynamicBenchmark(classicDynamicDocument, output, capacity);
    if (classicResultStatus() != 0) return 0;
    const length = load<u32>(classicResultHeader() + 24);
    if (length == 0) return 0;
    classicBenchmarkSink = (
      classicBenchmarkSink * 1664525 +
      length +
      load<u8>(output) +
      load<u8>(output + length - 1)
    ) | 0;
  }
  return classicBenchmarkSink | 1;
}

export function releaseClassicDynamicSerialize(): u32 {
  if (classicDynamicDocument == 0) return 0;
  const status = releaseDocument(classicDynamicDocument);
  classicDynamicDocument = 0;
  return status;
}

export function classicBenchmarkSinkValue(): u32 {
  return classicBenchmarkSink;
}
`;

const compilation = prepareArtifactCompilation({
  schemas: classicSchemas,
  directory: "build/classic",
  assemblySuffix: benchmarkAssembly,
  optimizeLevel: Number(process.env.JSON_TY_OPTIMIZE_LEVEL ?? "3"),
  kernelTier: process.env.JSON_TY_DISABLE_SIMD === "1"
    ? "swar"
    : (process.env.JSON_TY_KERNEL_TIER ?? "swar"),
});
await compilation.compile();

console.log("> build/classic/runtime.wasm");

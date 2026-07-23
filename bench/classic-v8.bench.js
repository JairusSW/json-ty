// d8/V8-shell benchmark backend. Timed loops run either wholly in JavaScript
// (native JSON.parse) or wholly in Wasm (json-ty), with changing inputs and a
// stateful checksum so neither optimizer can discard the work.

const wasmPath = arguments[0];
const payloadPath = arguments[1];
const corpus = arguments[2];
const targetMs = Math.max(25, Number(arguments[3] || 200));
const source = read(payloadPath);

function varyStringValue(value, ordinal) {
  let valueIndex = 0;
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) !== 34) continue;
    const start = ++index;
    let escaped = false;
    while (index < value.length) {
      const code = value.charCodeAt(index);
      if (escaped) escaped = false;
      else if (code === 92) escaped = true;
      else if (code === 34) break;
      index++;
    }
    let next = index + 1;
    while (next < value.length && [9, 10, 13, 32].includes(value.charCodeAt(next))) next++;
    if (value.charCodeAt(next) === 58) continue;
    for (let at = start; at < index; at++) {
      const code = value.charCodeAt(at);
      const replacement =
        code >= 48 && code <= 57 ? (code === 57 ? 48 : code + 1) :
        code >= 65 && code <= 90 ? (code === 90 ? 65 : code + 1) :
        code >= 97 && code <= 122 ? (code === 122 ? 97 : code + 1) : 0;
      if (replacement !== 0 && valueIndex++ === ordinal) {
        return value.slice(0, at) + String.fromCharCode(replacement) + value.slice(at + 1);
      }
    }
  }
  return ` ${value}`;
}

const rotateInputs = source.length <= (8 << 20);
const sources = rotateInputs
  ? [0, 1, 2, 3].map((ordinal) => varyStringValue(source, ordinal))
  : [source, source, source, source];
const fileBytes = new Uint8Array(readbuffer(payloadPath));

function encodeUtf8(value) {
  const output = [];
  for (let index = 0; index < value.length; index++) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
        index++;
      }
    }
    if (code <= 0x7f) output.push(code);
    else if (code <= 0x7ff) output.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
    else if (code <= 0xffff) output.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
    else output.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3f), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(output);
}

function wrapPoet(value) {
  const output = new Uint8Array(value.byteLength + 10);
  output.set([0x7b, 0x22, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x22, 0x3a], 0);
  output.set(value, 9);
  output[output.length - 1] = 0x7d;
  return output;
}

// Rotate same-shape payloads for fixtures small enough to
// keep four resident copies. Setup and UTF-8 encoding remain outside timing.
const rawEncoded = rotateInputs ? sources.map(encodeUtf8) : [fileBytes, fileBytes, fileBytes, fileBytes];
const typedEncoded = corpus === "poet" ? rawEncoded.map(wrapPoet) : rawEncoded;

const PAGE = 65536;
const align = (value, multiple) => Math.ceil(value / multiple) * multiple;
const control = 1024;
const sourceBase = PAGE;
const rawStride = rotateInputs ? align(rawEncoded[0].byteLength, 8) : 0;
const rawCapacity = rotateInputs ? rawStride * 4 : rawEncoded[0].byteLength;
const typedBase = align(sourceBase + rawCapacity, 8);
const typedStride = rotateInputs ? align(typedEncoded[0].byteLength, 8) : 0;
const typedCapacity = rotateInputs ? typedStride * 4 : typedEncoded[0].byteLength;
const output = align(typedBase + typedCapacity + PAGE, PAGE);
const outputCapacity = 256 << 20;
const heapBase = align(output + outputCapacity, PAGE);
// Dynamic materialization reserves source bytes plus a worst-case 16-byte slot
// per input byte. Size the initial memory from that public runtime contract so
// OTFCC and FGO fail only when their graph actually exceeds the Wasm32 space,
// not because the benchmark happened to use a 1 GiB default.
const dynamicCapacity = align(fileBytes.byteLength * 17 + 2048, PAGE);
const initialPages = Math.max(16384, Math.ceil((heapBase + dynamicCapacity) / PAGE));
if (initialPages > 49152) throw new Error(`classic fixture requires ${initialPages} Wasm pages`);
const memory = new WebAssembly.Memory({ initial: initialPages, maximum: 49152 });
const module = new WebAssembly.Module(readbuffer(wasmPath));
const instance = new WebAssembly.Instance(module, {
  env: {
    memory,
    parseNumberSlow(pointer, length) {
      const view = new Uint8Array(memory.buffer, pointer, length);
      let text = "";
      for (let index = 0; index < view.length; index++) text += String.fromCharCode(view[index]);
      return Number(text);
    },
  },
});
const api = instance.exports;
const scratchCapacity = output - sourceBase;
if (api.initialize(control, sourceBase, scratchCapacity, heapBase, memory.buffer.byteLength) !== 0) {
  throw new Error("json-ty runtime initialization failed");
}
const bytes = new Uint8Array(memory.buffer);
for (let index = 0; index < (rotateInputs ? 4 : 1); index++) {
  bytes.set(rawEncoded[index], sourceBase + rawStride * index);
  bytes.set(typedEncoded[index], typedBase + typedStride * index);
}

let nativeSink = 0x9e3779b9 | 0;
function runNative(iterations) {
  for (let index = 0; index < iterations; index++) {
    const value = JSON.parse(sources[index & 3]);
    const shape = Array.isArray(value) ? value.length : Object.keys(value).length;
    nativeSink = (Math.imul(nativeSink, 1664525) + shape + sources[index & 3].charCodeAt(0)) | 0;
  }
  return nativeSink;
}

const nativeDocument = JSON.parse(source);
function runNativeSerialize(iterations) {
  for (let index = 0; index < iterations; index++) {
    const value = JSON.stringify(nativeDocument);
    nativeSink = (Math.imul(nativeSink, 1664525) + value.length + value.charCodeAt(0) + value.charCodeAt(value.length - 1)) | 0;
  }
  return nativeSink;
}

function wasmRoutine(name, typed = false) {
  const routine = api[name];
  if (typeof routine !== "function") throw new Error(`missing Wasm benchmark export ${name}`);
  const base = typed ? typedBase : sourceBase;
  const stride = typed ? typedStride : rawStride;
  const length = typed ? typedEncoded[0].byteLength : rawEncoded[0].byteLength;
  return name.includes("Into")
    ? (iterations) => routine(base, stride, length, output, outputCapacity, iterations)
    : (iterations) => routine(base, stride, length, iterations);
}

function measure(name, routine) {
  routine(1);
  let iterations = 1;
  let elapsed = 0;
  const calibrationMs = Math.min(50, Math.max(20, targetMs / 4));
  while (elapsed < calibrationMs) {
    const start = performance.now();
    const checksum = routine(iterations);
    elapsed = performance.now() - start;
    if (checksum === 0) throw new Error(`${name} returned a zero checksum`);
    if (elapsed < calibrationMs) iterations *= Math.max(2, Math.ceil(calibrationMs / Math.max(elapsed, 0.01)));
  }
  iterations = Math.max(1, Math.ceil(iterations * targetMs / elapsed));
  let measuredMs = 0;
  let checksum = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    routine(Math.max(1, Math.floor(iterations / 10)));
    const start = performance.now();
    checksum = routine(iterations);
    measuredMs = performance.now() - start;
    if (measuredMs >= targetMs * 0.8) break;
    iterations = Math.max(iterations + 1, Math.ceil(iterations * targetMs * 1.05 / Math.max(measuredMs, 0.01)));
  }
  if (checksum === 0) throw new Error(`${name} returned a zero checksum`);
  const mbps = (fileBytes.byteLength * iterations) / (measuredMs / 1000) / 1e6;
  return {
    corpus,
    name,
    elapsed: measuredMs,
    operations: iterations,
    bytes: fileBytes.byteLength,
    nsPerOp: measuredMs * 1e6 / iterations,
    mbps,
    checksum: checksum | 0,
  };
}

const typedPrefix = corpus === "poet" ? "PoemArray" : corpus === "canada" ? "Canada" : null;
const results = [measure("native", runNative)];
if (typedPrefix) {
  results.push(measure("json-ty-into", wasmRoutine(`benchmark${typedPrefix}IntoTrusted`, true)));
  results.push(measure("json-ty-owned", wasmRoutine(`benchmark${typedPrefix}OwnedTrusted`, true)));
}
if (corpus === "canada") {
  results.push(measure("json-ty-lazy-into", wasmRoutine("benchmarkCanadaLazyIntoTrusted", true)));
  results.push(measure("json-ty-lazy-owned", wasmRoutine("benchmarkCanadaLazyOwnedTrusted", true)));
}
results.push(measure("json-ty-dynamic", wasmRoutine("benchmarkDynamicOwnedTrusted")));
if (corpus === "otfcc" || corpus === "fgo") {
  results.push(measure("json-ty-projected", wasmRoutine("benchmarkRootKindsTrusted")));
}
if (corpus === "lottie") {
  results.push(measure("json-ty-projected", wasmRoutine("benchmarkLottieProjectionTrusted")));
}
if (corpus === "citm_catalog") {
  results.push(measure("json-ty-projected", wasmRoutine("benchmarkCitmProjectionTrusted")));
}
results.push(measure("json-ty-raw", wasmRoutine("benchmarkRawValidate")));
results.push(measure("native-serialize", runNativeSerialize));
if (api.prepareClassicDynamicSerialize(sourceBase, fileBytes.byteLength) === 0) {
  throw new Error("failed to prepare dynamic serialization document");
}
results.push(measure("json-ty-serialize", (iterations) => api.benchmarkClassicDynamicSerialize(output, outputCapacity, iterations)));
if (api.releaseClassicDynamicSerialize() !== 0) throw new Error("failed to release dynamic serialization document");

for (const result of results) {
  print(`${result.name.padEnd(18)} ${Math.round(result.mbps).toLocaleString().padStart(8)} MB/s  ${result.nsPerOp.toFixed(0).padStart(10)} ns/op`);
}
print(`__JSON_TY_CLASSIC_V8__${JSON.stringify({ corpus, targetMs, engine: "v8", results })}`);

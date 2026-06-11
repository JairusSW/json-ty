export async function instantiate(module, imports = {}) {
  const adaptedImports = {
    env: Object.setPrototypeOf({
      abort(message, fileName, lineNumber, columnNumber) {
        // ~lib/builtins/abort(~lib/string/String | null?, ~lib/string/String | null?, u32?, u32?) => void
        message = __liftString(message >>> 0);
        fileName = __liftString(fileName >>> 0);
        lineNumber = lineNumber >>> 0;
        columnNumber = columnNumber >>> 0;
        (() => {
          // @external.js
          throw Error(`${message} in ${fileName}:${lineNumber}:${columnNumber}`);
        })();
      },
    }, Object.assign(Object.create(globalThis), imports.env || {})),
  };
  const { exports } = await WebAssembly.instantiate(module, adaptedImports);
  const memory = exports.memory || imports.env.memory;
  const adaptedExports = Object.setPrototypeOf({
    srcPtr() {
      // src/wasm/parser/srcPtr() => usize
      return exports.srcPtr() >>> 0;
    },
    reserve(n) {
      // src/wasm/parser/reserve(i32) => usize
      return exports.reserve(n) >>> 0;
    },
    parse(sid, len) {
      // src/wasm/parser/parse(i32, i32) => usize
      return exports.parse(sid, len) >>> 0;
    },
    parseArrayOf(elemSid, len) {
      // src/wasm/parser/parseArrayOf(i32, i32) => usize
      return exports.parseArrayOf(elemSid, len) >>> 0;
    },
    parsePrimArray(len) {
      // src/wasm/parser/parsePrimArray(i32) => usize
      return exports.parsePrimArray(len) >>> 0;
    },
    enterObject(sid, off, len) {
      // src/wasm/parser/enterObject(i32, i32, i32) => usize
      return exports.enterObject(sid, off, len) >>> 0;
    },
  }, exports);
  function __liftString(pointer) {
    if (!pointer) return null;
    const
      end = pointer + new Uint32Array(memory.buffer)[pointer - 4 >>> 2] >>> 1,
      memoryU16 = new Uint16Array(memory.buffer);
    let
      start = pointer >>> 1,
      string = "";
    while (end - start > 1024) string += String.fromCharCode(...memoryU16.subarray(start, start += 1024));
    return string + String.fromCharCode(...memoryU16.subarray(start, end));
  }
  return adaptedExports;
}

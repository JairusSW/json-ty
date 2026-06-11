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
      // experiments/eager-parse/assembly/eager/srcPtr() => usize
      return exports.srcPtr() >>> 0;
    },
    parseEagerObject(sid, len) {
      // experiments/eager-parse/assembly/eager/parseEagerObject(i32, i32) => usize
      return exports.parseEagerObject(sid, len) >>> 0;
    },
    parseEagerArray(elemSid, len) {
      // experiments/eager-parse/assembly/eager/parseEagerArray(i32, i32) => usize
      return exports.parseEagerArray(elemSid, len) >>> 0;
    },
    parseEagerPrim(len) {
      // experiments/eager-parse/assembly/eager/parseEagerPrim(i32) => usize
      return exports.parseEagerPrim(len) >>> 0;
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

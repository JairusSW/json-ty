import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const path = process.argv[2];
if (!path) throw new TypeError("Usage: node bench/run-json-as-artifact.mjs <benchmark.wasm>");
const projectRoot = resolve(process.argv[3] ?? dirname(resolve(path)), "..");
let memory;
let exports;
const liftString = (pointer) => {
  if (!pointer) return null;
  const words = new Uint32Array(memory.buffer);
  const end = (pointer + words[(pointer - 4) >>> 2]) >>> 1;
  return new TextDecoder("utf-16le").decode(new Uint8Array(memory.buffer, pointer, end * 2 - pointer));
};
const module = new WebAssembly.Module(readFileSync(path));
({ exports } = new WebAssembly.Instance(module, {
  env: {
    abort(message, file, line) {
      throw new Error(`${liftString(message)} at ${liftString(file)}:${line}`);
    },
    "performance.now": () => performance.now(),
    "Date.now": () => Date.now(),
    "console.log": (pointer) => console.log(liftString(pointer)),
    writeFile() {},
    readFile(pointer) {
      const relative = liftString(pointer);
      const bytes = readFileSync(resolve(projectRoot, relative));
      const output = exports.__new(bytes.byteLength, 1) >>> 0;
      new Uint8Array(memory.buffer, output, bytes.byteLength).set(bytes);
      return output;
    },
  },
}));
memory = exports.memory;
exports.start();

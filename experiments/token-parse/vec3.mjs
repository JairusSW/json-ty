// Vec3 parsed from the SIMD token stream (generic stage-1 tokenizer + schema
// navigation). Lazy: getters materialize each number from its span on access.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const inst = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(join(HERE, "build/tokenizer.wasm"))),
  { env: { abort: () => { throw new Error("abort"); } } },
);
const ex = inst.exports;
const SRC = ex.srcPtr() >>> 0;
const TOK = ex.tokensPtr() >>> 0;
const u8 = new Uint8Array(ex.memory.buffer);
const i32 = new Int32Array(ex.memory.buffer);
const TOK32 = TOK >>> 2;
const nbuf = Buffer.from(ex.memory.buffer); // Node copy-in/out over wasm memory
const dec = new TextDecoder();

// A cursor over the token stream: token k's byte offset and its type (the byte).
class Tokens {
  constructor(count) { this.count = count; }
  off(k) { return i32[TOK32 + k]; }
  type(k) { return u8[SRC + i32[TOK32 + k]]; } // structural char, or 0x22 for a quote
}

const QUOTE = 0x22, RBRACE = 0x7d, COMMA = 0x2c;

class Vec3 {
  #sx = -1; #ex = 0; #sy = -1; #ey = 0; #sz = -1; #ez = 0; // value spans (-1 = absent)
  #x; #y; #z;
  constructor(t) {
    // walk the object: { ("key" : value ,)* }
    let k = 1; // token 0 is '{'
    while (k < t.count && t.type(k) !== RBRACE) {
      const keyByte = u8[SRC + t.off(k) + 1]; // single-char key (x/y/z) for Vec3
      const colon = k + 2;
      const valStart = t.off(colon) + 1;
      const valEnd = t.off(colon + 1); // next token (',' or '}') bounds the value
      if (keyByte === 0x78) { this.#sx = valStart; this.#ex = valEnd; }
      else if (keyByte === 0x79) { this.#sy = valStart; this.#ey = valEnd; }
      else if (keyByte === 0x7a) { this.#sz = valStart; this.#ez = valEnd; }
      k += 3;
      if (t.type(k) === COMMA) k++; else break;
    }
  }
  #num(s, e) { return s < 0 ? undefined : parseFloat(dec.decode(u8.subarray(SRC + s, SRC + e))); }
  get x() { return (this.#x ??= this.#num(this.#sx, this.#ex)); }
  get y() { return (this.#y ??= this.#num(this.#sy, this.#ey)); }
  get z() { return (this.#z ??= this.#num(this.#sz, this.#ez)); }
}

export function parseVec3(json) {
  const len = nbuf.write(json, SRC, "utf8");
  const count = ex.tokenize(len);
  return new Vec3(new Tokens(count));
}

if (process.argv[1] && process.argv[1].endsWith("vec3.mjs")) {
  const cases = [
    '{"x":3.4,"y":1.2,"z":8.3}',
    '{ "x" : -2 , "y": 0 , "z": 8.25e1 }',
    '{"x":1,"z":3}',
    '{"z":3,"y":2,"x":1}',
    '{"x":1.5,"y":2.5,"z":3.5,"w":9}', // extra field ignored
  ];
  console.log("correctness:");
  for (const c of cases) {
    const v = parseVec3(c), n = JSON.parse(c);
    const ok = v.x === n.x && v.y === n.y && v.z === n.z;
    console.log(`  ${ok ? "OK " : "FAIL"}  ${c}  =>  x=${v.x} y=${v.y} z=${v.z}`);
  }

  const json = '{"x":3.4,"y":1.2,"z":8.3}';
  const bb = (x) => x;
  const time = (fn, ops) => { let w = ops / 10; while (w-- > 0) fn(); const s = performance.now(); let c = ops; while (c-- > 0) fn(); return performance.now() - s; };
  const OPS = 2_000_000, r = (ms) => Math.round((OPS * 1000) / ms).toLocaleString();
  const tNa = time(() => { const o = JSON.parse(json); bb(o.x + o.y + o.z); }, OPS);
  const tTa = time(() => { const v = parseVec3(json); bb(v.x + v.y + v.z); }, OPS);
  const tNo = time(() => { const o = JSON.parse(json); bb(o.y); }, OPS);
  const tTo = time(() => { const v = parseVec3(json); bb(v.y); }, OPS);
  console.log("\nthroughput (ops/s):");
  console.log(`  read all 3   native ${r(tNa)}   |  token ${r(tTa)}`);
  console.log(`  read 1 of 3  native ${r(tNo)}   |  token ${r(tTo)}`);
}

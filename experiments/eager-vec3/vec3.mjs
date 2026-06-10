// Eager Vec3: AS parses x/y/z to f64; JS reads the three doubles directly.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const inst = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(join(HERE, "build/eager.wasm"))),
  { env: { abort: () => { throw new Error("abort"); } } },
);
const ex = inst.exports;
const SRC = ex.srcPtr() >>> 0;
const SLOTS = ex.slotsPtr() >>> 0;
const f64 = new Float64Array(ex.memory.buffer);
const SLOTS64 = SLOTS >>> 3;
const nbuf = Buffer.from(ex.memory.buffer);

export function parseVec3(json) {
  const len = nbuf.write(json, SRC, "utf8");
  if (ex.parseVec3(len) !== 0) throw new SyntaxError("json-ty: parse error");
  const x = f64[SLOTS64], y = f64[SLOTS64 + 1], z = f64[SLOTS64 + 2];
  // NaN slot = absent -> undefined (JSON numbers are never NaN)
  return {
    x: x === x ? x : undefined,
    y: y === y ? y : undefined,
    z: z === z ? z : undefined,
  };
}

if (process.argv[1] && process.argv[1].endsWith("vec3.mjs")) {
  const cases = [
    '{"x":3.4,"y":1.2,"z":8.3}',
    '{ "x" : -2 , "y": 0 , "z": 8.25e1 }',
    '{"x":1,"z":3}',
    '{"z":3,"y":2,"x":1}',
    '{"x":1.5,"y":2.5,"z":3.5,"w":9}',
    '{"x":-0.0001,"y":123456.789,"z":1e-7}',
  ];
  console.log("correctness (eager parse must match native exactly):");
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
  const tEa = time(() => { const v = parseVec3(json); bb(v.x + v.y + v.z); }, OPS);
  console.log("\nthroughput (ops/s) — eager parses all 3 up front:");
  console.log(`  read all 3   native ${r(tNa)}   |  eager ${r(tEa)}   =>  ${(tNa / tEa).toFixed(2)}× native`);
}

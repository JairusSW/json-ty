// Consolidated parse bench: native vs the three WASM approaches, one process so
// the numbers are comparable. Vec3, read 1 of 3 vs read all 3.
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseVec3 as lazySlot } from "./lazy-vec3/vec3.mjs";
import { parseVec3 as token } from "./token-parse/vec3.mjs";
import { parseVec3 as eager } from "./eager-vec3/vec3.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const json = '{"x":3.4,"y":1.2,"z":8.3}';
const bb = (x) => x;
const time = (fn, ops) => { let w = ops / 10; while (w-- > 0) fn(); const s = performance.now(); let c = ops; while (c-- > 0) fn(); return performance.now() - s; };
const OPS = 2_000_000;
const opsPerSec = (ms) => (OPS * 1000) / ms / 1e6; // M ops/s

const approaches = {
  native: { parse: (j) => JSON.parse(j) },
  "lazy-slot": { parse: lazySlot },
  token: { parse: token },
  eager: { parse: eager },
};

// sanity
for (const [name, a] of Object.entries(approaches)) {
  const v = a.parse(json);
  if (v.x !== 3.4 || v.y !== 1.2 || v.z !== 8.3) { console.log("MISMATCH", name, v); process.exit(1); }
}

const rows = [];
for (const [name, a] of Object.entries(approaches)) {
  const read1 = opsPerSec(time(() => { const v = a.parse(json); bb(v.y); }, OPS));
  const readAll = opsPerSec(time(() => { const v = a.parse(json); bb(v.x + v.y + v.z); }, OPS));
  rows.push({ approach: name, "read 1 of 3": read1, "read all 3": readAll });
}

console.log("Vec3 parse — M ops/s (higher = better)\n");
console.log("approach      read 1 of 3   read all 3");
console.log("-".repeat(40));
for (const r of rows) {
  console.log(`${r.approach.padEnd(12)} ${r["read 1 of 3"].toFixed(2).padStart(10)}  ${r["read all 3"].toFixed(2).padStart(10)}`);
}
mkdirSync(join(HERE, "build/logs"), { recursive: true });
writeFileSync(join(HERE, "build/logs/parse-bench.json"), JSON.stringify(rows, null, 2));
console.log("\nwrote build/logs/parse-bench.json");

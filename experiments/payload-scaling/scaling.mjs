// How the WASM SIMD structural index (stage-1) scales with payload size, vs
// native full JSON.parse. tokenize = the lazy-parse foundation: index the doc,
// then materialize only what's touched. native = full eager parse (the bar).
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const inst = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(join(HERE, "build/tokenizer.wasm"))),
  { env: { abort: () => { throw new Error("abort"); } } },
);
const ex = inst.exports;
const SRC = ex.srcPtr() >>> 0;
const nbuf = Buffer.from(ex.memory.buffer);

// ---- payloads (shapes modeled on json-as small/medium/large) --------------
const small = '{"id":1,"name":"Small Object","active":true}';

const mediumObj = {
  id: 42, username: "jairus", full_name: "Jairus Tanaka", email: "me@jairus.dev",
  avatar_url: "https://avatars.githubusercontent.com/u/123456?v=4",
  bio: "I like compilers, elegant algorithms, bare metal, simd, and wasm.",
  website: "https://jairus.dev/", location: "Seattle, WA",
  joined_at: "2020-01-15T08:30:00Z", is_verified: true, is_premium: true,
  followers: 1234, following: 56, public_repos: 78,
  prefs: { theme: "dark", notifications: true, language: "en-US", timezone: "America/Los_Angeles", privacy_level: "friends_only", two_factor_enabled: false },
  recent: [
    { action: "push", timestamp: "2024-01-01T00:00:00Z", target: "json-ty" },
    { action: "star", timestamp: "2024-01-02T00:00:00Z", target: "utf-as" },
    { action: "fork", timestamp: "2024-01-03T00:00:00Z", target: "json-as" },
  ],
};
const medium = JSON.stringify(mediumObj);

// large: an array of ~1500 medium-ish records (~1 MB)
const largeArr = [];
for (let i = 0; i < 1500; i++) largeArr.push({ ...mediumObj, id: i, username: "user" + i });
const large = JSON.stringify(largeArr);

const cases = [
  { name: "small", str: small },
  { name: "medium", str: medium },
  { name: "large", str: large },
];

const bb = (x) => x;
const timeMs = (fn, ops) => { let w = Math.max(1, ops / 10) | 0; while (w-- > 0) fn(); const s = performance.now(); let c = ops; while (c-- > 0) fn(); return performance.now() - s; };
const mbps = (bytes, ops, ms) => (bytes * ops) / (ms / 1000) / 1e6;

console.log("payload   bytes      native    copy-in   tokenize  copy+tok   tokens   tok/native");
console.log("-".repeat(86));
const results = [];
for (const c of cases) {
  const bytes = Buffer.byteLength(c.str, "utf8");
  const ops = Math.min(2_000_000, Math.max(200, Math.round((48 << 20) / bytes)));

  // prime + token count
  const len = nbuf.write(c.str, SRC, "utf8");
  const ntok = ex.tokenize(len);

  const tNative = timeMs(() => bb(JSON.parse(c.str)), ops);
  const tCopy = timeMs(() => bb(nbuf.write(c.str, SRC, "utf8")), ops);
  const tTok = timeMs(() => bb(ex.tokenize(len)), ops);            // bytes resident
  const tCT = timeMs(() => { nbuf.write(c.str, SRC, "utf8"); bb(ex.tokenize(len)); }, ops); // full stage-1

  const f = (v) => String(Math.round(v)).padStart(8);
  const nat = mbps(bytes, ops, tNative), ct = mbps(bytes, ops, tCT);
  console.log(`${c.name.padEnd(8)} ${String(bytes).padStart(8)} ${f(nat)} ${f(mbps(bytes, ops, tCopy))} ${f(mbps(bytes, ops, tTok))} ${f(ct)} ${String(ntok).padStart(8)}  ${(ct / nat).toFixed(2)}×`);
  results.push({ name: c.name, bytes, native: nat, copyIn: mbps(bytes, ops, tCopy), tokenize: mbps(bytes, ops, tTok), copyTokenize: ct, tokens: ntok });
}
mkdirSync(join(HERE, "build/logs"), { recursive: true });
writeFileSync(join(HERE, "build/logs/scaling.json"), JSON.stringify(results, null, 2));
console.log("\nnative   = full eager JSON.parse (the bar).");
console.log("tokenize = SIMD structural index of resident bytes (lazy-parse stage 1).");
console.log("copy+tok = Buffer.write into WASM + tokenize (stage 1 from a JS string).");
console.log("wrote build/logs/scaling.json");

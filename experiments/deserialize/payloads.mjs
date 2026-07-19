// Bench payloads ported from json-as (bench/*.bench.ts — same author, MIT).
// abc/uuid are bare strings; wrapped in {v:...} so the object engine applies.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));

const abc = '{"v":"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"}';
const uuidv4 = '{"v":"75a60587-c4d7-4764-91ac-9fd1d6baf07e"}';
const token = '{"uid":256,"token":"dewf32df@#G43g3Gs!@3sdfDS#2"}';
const small = '{"id":1,"name":"Small Object","active":true}';

// medium: MediumAPIResponse (reconstructed from json-as bench/medium.bench.ts)
const mediumObj = {
  id: 42, username: "jairus", full_name: "Jairus Tanaka", email: "me@jairus.dev",
  avatar_url: "https://avatars.githubusercontent.com/u/123456?v=4",
  bio: "I like compilers, elegant algorithms, bare metal, simd, and wasm.",
  website: "https://jairus.dev/", location: "Seattle, WA", joined_at: "2020-01-15T08:30:00Z",
  is_verified: true, is_premium: true, follower_count: 61, following_count: 39,
  preferences: { theme: "dark", notifications: true, language: "en-US", timezone: "America/Los_Angeles", privacy_level: "friends_only", two_factor_enabled: false },
  tags: ["typescript", "webassembly", "performance", "rust", "assemblyscript", "json"],
  recent_activity: [
    { action: "starred", timestamp: "2025-12-22T10:15:00Z", target: "assemblyscript/json-as" },
    { action: "commented", timestamp: "2025-12-22T09:42:00Z", target: "issue #142" },
    { action: "pushed", timestamp: "2025-12-21T23:58:00Z", target: "main branch" },
    { action: "forked", timestamp: "2025-12-21T18:20:00Z", target: "fast-json-wasm" },
    { action: "created", timestamp: "2025-12-21T14:10:00Z", target: "new benchmark suite" },
  ],
};
const medium = JSON.stringify(mediumObj);

// large: github repo response — extracted verbatim from json-as bench/large.bench.ts
const largeSrc = readFileSync(join(HERE, "../../../json-as/bench/large.bench.ts"), "utf8");
const large = largeSrc.match(/const v2 = `([^`]*)`/)[1];

export const PAYLOADS = [
  { name: "abc", json: abc },
  { name: "uuidv4", json: uuidv4 },
  { name: "token", json: token },
  { name: "small", json: small },
  { name: "medium", json: medium },
  { name: "large", json: large },
];

# Token-stream parse (SIMD stage-1 + schema navigation)

A more general alternative to the schema-directed slot scan in
[../lazy-vec3](../lazy-vec3). Two stages, simdjson-style:

1. **`assembly/tokenizer.ts`** — SIMD structural tokenizer (ported from
   [../simd-string](../simd-string)). For each 16-byte block it `v128`-masks the
   structural bytes (`{ } [ ] : ,`) and quotes; numbers/whitespace/words between
   them are bulk-skipped. Emits a **token stream**: the byte offset of every
   structural char and both quotes of every string. Schema-agnostic — one scan
   serves any type.
2. **`vec3.mjs`** — a JS `Tokens` cursor (`off(k)` / `type(k)`) plus schema
   navigation: walk `{ ("key" : value ,)* }`, match keys, record value spans,
   materialize numbers lazily on getter access.

```bash
npx asc experiments/token-parse/assembly/tokenizer.ts \
  --outFile experiments/token-parse/build/tokenizer.wasm \
  -O3 --noAssert --bindings raw --runtime stub --exportRuntime --enable simd
node experiments/token-parse/vec3.mjs
```

## Result

Correct on whitespace, scientific notation, missing fields (→ `undefined`),
out-of-order keys, **and extra fields** (ignored for free — the navigator only
matches `x`/`y`/`z`).

```
throughput (ops/s), 25-byte Vec3:
  read all 3   native 5,413,769   |  token 2,562,297
  read 1 of 3  native 5,320,940   |  token 5,209,811   (≈ tie)
```

## Token stream vs schema-directed slot scan

Two valid designs, clear trade-off:

- **Slot scan** ([../lazy-vec3](../lazy-vec3)): AS finds exactly the N known keys
  and writes N value spans. Leanest for a fixed schema (beat native ~1.2× on
  read-1). No general token stream.
- **Token stream** (here): one schema-agnostic SIMD scan → a reusable token
  index; JS navigates it per schema. More general (any type, extra fields,
  nesting-ready) and the right foundation for dynamic `JSON.Value`/`Obj`, but
  carries more work (full token stream + JS walk), so it ties native on read-1
  and loses on read-all-3.

Both materialize numbers lazily (`parseFloat` per accessed field) — that
per-field `TextDecode`+`parseFloat` is why read-all loses; **inline-f64 slots**
(parse the number into the index during the scan) is the fix for both. The token
stream is the better base to build the general parser on; keep the slot scan as a
fast path for hot fixed schemas.

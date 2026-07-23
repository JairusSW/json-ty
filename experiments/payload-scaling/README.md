# Payload scaling: stage-1 structural index vs native parse

How the WASM approach scales across small / medium / large realistic JSON
(shapes modeled on json-as's payloads). Uses the generic SIMD tokenizer
(schema-agnostic), so it indexes any document.

```bash
npx asc assembly/experiments/payload-scaling/tokenizer.ts \
  --outFile experiments/payload-scaling/build/tokenizer.wasm \
  -O3 --noAssert --bindings raw --runtime stub --exportRuntime --enable simd
node experiments/payload-scaling/scaling.mjs   # -> build/logs/scaling.json
node experiments/payload-scaling/chart.mjs     # -> scaling.png
```

The tokenizer is **bitmask + ctz stage-1** (simdjson-style): per 16-byte block,
`i8x16.bitmask` the structural/quote lanes and `ctz`-iterate the set bits to emit
every token from one SIMD op; string bodies are bulk-skipped with a second SIMD
scan (quote/backslash), scalar only at an escape. Verified byte-identical to the
naive scalar tokenizer across structural-chars-in-strings, escaped quotes/
backslashes, deep nesting, unicode, and large arrays.

## Results (Node, MB/s of input)

| payload | bytes   | native | copy-in | tokenize | copy+tok | tok/native |
|---------|--------:|-------:|--------:|---------:|---------:|-----------:|
| small   | 44      | 233    | 1,839   | 900      | 632      | 2.7×       |
| medium  | 782     | 477    | 19,000  | 1,559    | 1,472    | 3.0×       |
| large   | 1.18 MB | 500    | 54,000  | 1,586    | 1,547    | 3.1×       |

(Optimization lifted tokenize from ~1.15 GB/s / 2.25× to ~1.59 GB/s / 3.1×.)

- **Copy-in is free and scales** — `Buffer.write` into WASM hits 55 GB/s at 1 MB.
  Getting bytes into linear memory is never the cost.
- **Stage-1 structural indexing is ~2.3× faster than native full parse**, and the
  ratio holds steady from 44 B to 1.2 MB. This is the lazy-parse foundation:
  index the whole doc at 2.3× native, then materialize only the fields touched
  (numbers eager, strings lazy). Touch a subset → total well under native.
- **native full parse is flat at ~0.5 GB/s** regardless of size (it materializes
  the entire JS object tree every time).

## Where the remaining cost is (~1.59 GB/s ceiling)

After bitmask+ctz and SIMD string-skip, tokenize is bound by the **per-token
emission itself**: the large doc has 264 K tokens (one every ~4.5 bytes), each a
ctz + i32 store ≈ 2.8 ns. The SIMD now finds tokens nearly for free; the cost is
*writing them out*. Further gains need either **fewer tokens** (e.g. one token
per string instead of two; drop implied `:`), or **branchless bulk emission** of
the bitmask to the token array — simdjson uses `vpcompress`/shuffle tables for
this, which WASM SIMD lacks (no `vpcompress`, no clmul), so a portable version
would lean on precomputed per-byte shuffle tables. ~3.1× native is a solid result
for the stage-1 index that backs lazy parsing; pushing past it is a separate
deep-dive.

# SIMD JSON-string serializer vs native

A JSON string serializer's hot work is **finding bytes that need escaping**
(`< 0x20`, `"`, `\`). For a clean string the output is just the input wrapped in
quotes, so the scan *is* the work. `assembly/escape.ts` does that scan 16 bytes
at a time with `v128`; `bench.mjs` compares it to native `JSON.stringify`.

```bash
npx asc experiments/simd-string/assembly/escape.ts \
  --outFile experiments/simd-string/build/escape.wasm \
  -O3 --noAssert --bindings raw --runtime stub --exportRuntime --enable simd
node experiments/simd-string/bench.mjs
```

## Results (Node 24, clean ASCII, MB/s)

| size | native | scalar JS | simd-loop | **simd-bulk** | scan ceiling |
|-----:|-------:|----------:|----------:|--------------:|-------------:|
| 16B  | 300    | 554       | 450       | 386           | 2,683        |
| 64B  | 932    | 412       | 438       | 932           | 6,236        |
| 256B | 910    | 453       | 471       | **1,656**     | 10,846       |
| 1K   | 1,032  | 457       | 477       | **2,032**     | 13,160       |
| 16K  | 1,065  | 452       | 476       | **2,183**     | 14,335       |
| 256K | 606    | 445       | 477       | **2,206**     | 14,487       |
| 1M   | 661    | 444       | 476       | **2,207**     | 14,610       |

- **scan ceiling** — SIMD escape-scan of bytes already resident in WASM:
  **~14.6 GB/s**, ~14–22× native. The v128 lane is as fast as the boundary
  experiment promised.
- **simd-bulk** — end-to-end from a JS string: `encodeInto` copy-in + SIMD scan +
  wrap. **Beats native 1.8–3.6× for ≥256B**; ties at 64B; loses only at 16B
  (per-call overhead).
- **simd-loop** — same but the copy-in is a per-char `charCodeAt` loop. Flat at
  ~470 MB/s: byte-at-a-time JS is the bottleneck, not the scan. Use it only for
  tiny strings (no per-call setup); use `encodeInto` for everything else.

## Why this wins where the boundary experiment said serialize loses

The string-bridge experiment showed that *materializing a string across the
boundary* hits a 1.7 GB/s wall. The escape scan dodges that wall entirely:

1. **Clean output needs no materialization.** A clean string serializes to
   `"` + itself + `"` — so we never transcode anything back out of WASM. We stay
   in the **read-only scan lane (14 GB/s)**, never the materialize lane.
2. **The copy-in is the only real cost, and `encodeInto` is native-fast** (~2.2
   GB/s). encodeInto + a 14 GB/s SIMD scan ≈ 2.2 GB/s end-to-end — and that still
   beats native `JSON.stringify`, which does its own scan *and* allocates+copies
   a fresh output string.

So the rule from the boundary work holds: **scan-shaped work wins in WASM;
materialize-shaped work doesn't.** Escaping a clean string is scan-shaped.

## UTF-16 copy-in (charCodeAt → Uint16Array) — slower, and here's why

Idea: skip the UTF-8 transcode by `charCodeAt`-ing the string straight into a
`Uint16Array` over WASM memory and SIMD-scanning u16 units (JSON escapes are all
`< 0x80`, so this is valid). Measured:

| size | simd-u8bulk (encodeInto) | simd-u16 (charCodeAt loop) | u16-bulk (`Buffer.from`, Node-only) |
|-----:|-------------------------:|---------------------------:|------------------------------------:|
| 1K   | 2,069                    | 517                        | 2,115                               |
| 16K  | 2,236                    | 520                        | 1,259                               |
| 1M   | 2,243                    | 517                        | 3,242                               |

**simd-u16 is flat at ~520 MB/s — 4× slower than the UTF-8 path.** The lesson:
the bottleneck was never the transcode, it's **getting characters out of the JS
string at all**. `encodeInto` is a *native, bulk* primitive (~2.2 GB/s) that
happens to also transcode to UTF-8; a `charCodeAt` loop is per-char JS (~500
MB/s) no matter whether it writes u8 or u16. JS exposes **no portable bulk
UTF-16 extract** — only TextEncoder/`encodeInto` (UTF-8). The only way the u16
path competes is `Buffer.from(str,'utf16le')` (native bulk, but Node-only and
allocation-noisy). So: **stay on UTF-8 via `encodeInto`** — it wins precisely
because it's the one bulk copy-out JS gives you. (utf-as's transcode isn't even
on the critical path here; `encodeInto` is.)

## Node-tuned: `Buffer.write` copy-in (`tune-node.mjs`)

The portable path is bottlenecked by `encodeInto` (~2.2 GB/s). In **Node** we can
make the WASM memory a `Buffer` view once (`Buffer.from(memory.buffer)`, no copy)
and use `buf.write(str, SRC, 'utf8')` — a native bulk transcode straight into
linear memory with **zero allocation**. It's ~20× faster than `encodeInto`:

| size | native | encodeInto e2e | **bufUtf8 e2e** | bufUtf8 copy-only |
|-----:|-------:|---------------:|----------------:|------------------:|
| 256B | 918    | 1,719          | **3,180** (3.5×)| 4,602             |
| 1K   | 1,039  | 2,079          | **7,206** (6.9×)| 16,804            |
| 16K  | 1,067  | 2,235          | **11,611** (11×)| 55,103            |
| 256K | 598    | 2,237          | **11,987** (20×)| 65,829            |
| 1M   | 655    | 2,242          | **11,552** (18×)| 52,920            |

With the copy-in at 55–65 GB/s, it stops being the bottleneck and **end-to-end
becomes scan-bound at ~12 GB/s — 10–20× native `JSON.stringify` for ≥16K**, and
3.5–7× at 256B–1K. (16–64B still ties native: per-call overhead.)

Why `Buffer.write` ≫ `encodeInto`: it's Node's long-optimized native binding,
writes to an arbitrary offset, and returns a number (no `{read,written}` object
alloc per call). `'latin1'` is marginally faster but ASCII-only (mangles
≥ 0x80); **`'utf8'` is correct for all input and within noise of latin1**, so
that's the Node copy-in. Verified correct on ASCII + unicode (`café €17 😀`,
`日本語`) + escape cases.

> Node-only (`Buffer`). The generic/browser path falls back to `encodeInto`
> (still 1.8–3.6× native). A WASM SIMD copy-in is the portable thing to explore
> next.

## Dirty-path stress test — 1 MiB, full WASM round-trip (`escape-density.mjs`)

The real escaper (`escape()` in `assembly/escape.ts`) writes the escaped `"..."`
into an output buffer (SIMD-skips clean runs, bulk-copies them, escapes the rest
byte-for-byte matching `JSON.stringify`). `wasm` here is the **full round trip**:
`Buffer.write` in → SIMD escape → `Buffer.toString` out. `json-ty` is the real
`src/serialize/string.js`.

| density        | escapes | native | json-ty | fast-json-stringify | **wasm** | wasm/native |
|----------------|--------:|-------:|--------:|--------------------:|---------:|------------:|
| escape-free    |       0 | 703    | 672     | 833                 | **6,766**| **9.6×**    |
| light (~1%)    | 10,486  | 757    | 638     | 764                 | **5,016**| **6.6×**    |
| heavy (50%)    | 524,288 | 304    | 134     | 303                 | **306**  | **1.01×**   |

(MB/s of input; all outputs verified byte-identical to `JSON.stringify`.)
`fast-json-stringify` is only ~native-level for a *raw string* — its edge is
schema-compiling object shapes, of which a lone string has none.

- **Escape-free / lightly-escaped: WASM wins 7–11×.** SIMD bulk-skips clean runs;
  1% escapes barely register.
- **Heavy (50%): dead tie.** No clean runs to vectorize → scalar escape-per-byte
  + 1.5× output; SIMD has nothing to skip, so it matches native.
- **json-ty scalar only wins escape-free** (cons-string), and is *worst* under
  escaping (0.46× at heavy) — its per-char scan + `slice` is slow when escapes
  are dense.
- Round-trip escape-free is 7.2 GB/s *with* the read-back; the clean-wrap
  shortcut (no read-back) is ~11.5 GB/s. Both crush native. 50% is pathological;
  real strings live in the 7–11× zone.

## Honest caveats

- **Clean strings only (MVP).** Strings that actually need escaping fall back to
  `JSON.stringify` here. The full SIMD escaper *produces* output (materialize
  lane), so its win would be smaller — but escapes are rare in real payloads.
- **Output is a lazy cons-string** (`'"' + str + '"'` is O(1) in V8; native
  returns a flat string). This matches how json-ty measures serialization
  throughout (it's all `+`), but a consumer that flattens pays a copy later.
- **Surprise re: pure JS.** Measured cleanly in Node (identity blackbox), the
  scalar JS string serializer **loses to native for ≥64B** (~450 vs ~900 MB/s) —
  the earlier d8 "json-ty beats native on strings" was inflated by the d8
  natives-syntax blackbox. json-ty's *whole-object* wins (vec3/player) are a
  separate, real effect (skipping native's property enumeration).

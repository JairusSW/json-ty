# MVP: on-demand Vec3 parse over a WASM buffer

A minimal end-to-end implementation of [../PROTOCOL.md](../PROTOCOL.md) for one
schema: `Vec3 = { "x": number, "y": number, "z": number }`.

- `assembly/vec3.ts` — JSON stays as UTF-8 in linear memory (`SRC`). `scan(len)`
  does a schema-directed pass (find `x`/`y`/`z`) and writes a 16-byte header +
  three u64 slot words (compact `Raw` spans). Built `--runtime stub`; scan
  allocates nothing.
- `vec3.mjs` — JS writes the string into `SRC` (UTF-8 via `writeUtf8`: a tight
  ASCII `charCodeAt` loop, `encodeInto` fallback for non-ASCII — **never**
  `TextEncoder.encode`, which allocs and dominates), calls `scan`, and returns a
  lazy `Vec3` whose getters read a slot as two `Uint32` lanes and materialize the
  number from the source span on first access (memoized).

```bash
npx asc experiments/lazy-vec3/assembly/vec3.ts \
  --outFile experiments/lazy-vec3/build/vec3.wasm \
  -O3 --noAssert --bindings raw --runtime stub --exportRuntime
node experiments/lazy-vec3/vec3.mjs
```

## Result

Correct on whitespace, scientific notation, negatives, missing fields
(→ `undefined`), and out-of-order keys.

```
throughput (ops/s), 25-byte Vec3:
  read all 3   native 4,616,056   |  lazy 2,452,391
  read 1 of 3  native 4,588,363   |  lazy(str) 5,560,049   |  lazy(bytes) 5,799,211

breakdown (str input, read 1 of 3):
  old: TextEncoder.encode+set   307 ns/op   <- was ~60% of total
  new: writeUtf8 into SRC        30 ns/op    <- ASCII charCodeAt loop
  + wasm scan                    38 ns/op
  total parse+read1             180 ns/op    (was 499)
```

## What it confirms

Every number lines up with the string-bridge experiment:

- **`TextEncoder.encode` was the whole problem.** It's an allocating per-call
  transcode — 307 ns on a 25-byte string, dwarfing the boundary copy and the
  scan. Writing UTF-8 straight into `SRC` (ASCII `charCodeAt` loop) drops that to
  30 ns and cuts total parse+read1 from 499 ns to 180 ns.
- **Partial access now beats native even from a JS string** — read 1 of 3:
  **lazy(str) 5.56M vs native 4.59M = 1.21×**, and lazy(bytes) 5.80M. Once the
  input write is cheap, the string and bytes paths nearly converge.
- **Reading all 3 still loses** (2.45M vs 4.6M) — you pay per-field
  `TextDecode`+`parseFloat` for every field with no bulk work to amortize. That's
  the next target (inline-f64 slots → read the double straight from the slot).
- Vec3 (25B, all-cheap fields) is the *hardest* case for this design; the win
  regime is **large docs + partial access**, where 1.21× is the floor.

## Next

- Inline-scalar slots: have AS parse numbers to raw f64 bits in the slot (the
  protocol's non-span form) so a numeric getter reads 8 bytes with zero JS-side
  decode/`parseFloat`. Right call for numeric structs.
- Strings, nested objects (lazy sub-views), arrays (cursor) per PROTOCOL.md.
- The break-even sweep (fields-accessed vs native) on a realistic large doc.

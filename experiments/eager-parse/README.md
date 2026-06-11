# Eager parser → flat tables linked by pointers

The opposite end from the lazy engine. The deserialize bench showed the lazy path
loses **full read-all** on big docs (`large` 0.59×, `medium` 0.79×) — every getter
allocates a `decodeSlot` object + a memo `Map`, and arrays scatter records behind
pointers (no contiguous typed-array read).

This parser materializes everything in **one WASM pass** into **flat tables linked
by pointers**. Every value level is a contiguous table:
`[count u32][M u32]` then `count×M` 8-byte slots (record-major). A **nested
object/array becomes its own flat table** and the parent slot holds a **u32
pointer** to it. JS reads each table via typed arrays and follows pointers — zero
per-field allocation, no slot-decode object, no `Map`.

- `assembly/eager.ts` — `objTable` / `arrTable` (records contiguous via a side
  stack so nested allocations don't interleave) / `primTable`. Scalars inline
  (`f64`), strings as `(off,len)` spans, nested as u32 region pointers. Reuses
  `parseF64`/`skipString`/`scanComposite`/`matchKey`/`registerSchema`.
- `reader.mjs` — `num`/`bool`/`str` read from `Float64Array`/`Uint32Array`;
  `child` follows a pointer to a sub-table; `sumColumn` strides a numeric column.

```bash
bash experiments/eager-parse/run.sh     # build + bench + chart
```

## Results — full deserialize (read every field), MB/s

![eager](./eager.png)

| payload | bytes | native | lazy | **eager** | eager/native |
|---------|------:|-------:|-----:|----------:|-------------:|
| array: sum col (2000 recs) | 124 KB | 274 | 490 | **535** | **1.94×** |
| array: read-all            | 124 KB | 271 | 351 | **501** | **1.85×** |
| token   | 49    | 292 | ~284 | **476** | **1.63×** |
| small   | 44    | 197 | ~205 | **362** | **1.84×** |
| medium  | 1070  | 423 | **0.79× (lost)** | **791** | **1.87×** |
| large   | 5251  | 876 | **0.59× (lost)** | **967** | **1.11×** |

(lazy = `experiments/deserialize` read-all; correctness-gated vs native.)

## Why it wins (and where it matters)

- **It flips the case the lazy engine lost.** `medium`/`large` are nested
  string-heavy docs; lazy lost them (0.79×/0.59×). Eager flat-tables win
  (1.87×/1.11×) — no per-field `decodeSlot`/`Map`, contiguous reads, and nested
  objects are a pointer-follow into another flat array, not a re-parse.
- **Bulk numeric (1.94×):** JSON → a contiguous `Float64Array`; sum a column in a
  tight loop that **never builds a JS object**.
- **Two regimes, covered:** lazy wins *partial* access; eager flat-tables win
  *full deserialize* (and bulk/columnar). Same engine kernels, opposite buffer.

## Notes / scope

- `null` is stored as zero bytes (number → 0, string → ""); a string `null` isn't
  distinguished from `""` (both contribute 0 — matches native's "skip null").
- Wiring an `@eager` mode into the transform (pick lazy vs eager per `@json`
  class) is the natural integration; this is the standalone proof.

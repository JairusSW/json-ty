# Eager flat-buffer parser

The opposite end from the lazy engine. The deserialize bench showed the lazy
path loses **full read-all** on big docs because every getter allocates a
`{tag,off,len,ptr}` object (`decodeSlot`) + a memo `Map`, and arrays scatter
records behind pointers (no contiguous typed-array read).

This parser materializes everything in **one WASM pass** into a **contiguous,
row-major record buffer** JS reads with typed arrays — **zero per-field
allocation, no slot-decode object, no Map, no pointer indirection.**

- `assembly/eager.ts` — `parseEagerArray(elemSid, len)` parses a top-level array
  of flat objects into `[count u32][M u32]` + `count×M` 8-byte slots, record-major.
  number/bool → raw `f64`; string → `(off u32, len u32)` span into SRC. Reuses
  `parseF64` / `skipString` / `scanComposite` / `matchKey` / `registerSchema`
  from the lazy engine.
- `reader.mjs` — zero-alloc accessors: scalars from a `Float64Array`, string
  spans from a `Uint32Array` (slice-original for ASCII), `sumColumn` strides a
  numeric column.

```bash
bash experiments/eager-parse/run.sh     # build + bench + chart
```

## Results — array of 2000 flat records (~125 KB, `{id,x,y,name,active}`)

![eager](./eager.png)

| task | native | json-ty lazy | **json-ty eager** | eager/native |
|------|-------:|-------------:|------------------:|-------------:|
| sum the `x` column | 271 MB/s | 446 MB/s | **577 MB/s** | **2.13×** |
| read all fields    | 268 MB/s | 345 MB/s | **539 MB/s** | **2.01×** |

(MB/s; correctness-gated — eager/lazy sums and reads equal native.)

## Why it wins

- **Bulk numeric (2.13×):** JSON → a contiguous `Float64Array`. Summing a column
  is a tight typed-array loop that **never builds a JS object** — native must
  construct 2000 objects just to read one field each.
- **Full read-all (2.01×):** reads beat both native (no JS object tree) and the
  lazy engine (no `decodeSlot` object, no memo `Map`, contiguous records).

The flat row-major buffer is the "easily digestible buffer": field *f* of record
*r* is at a constant offset (`f64[base + r*M + f]`), so any access — single field,
whole record, or a strided column — is a direct memory read.

## Scope / follow-ups (v1)

- **Flat records only.** Nested objects / arrays-of-structs in a record are
  stored as `NaN` placeholders — they need recursive contiguous sub-blocks (or
  column flattening). That's why this targets uniform record arrays, not the
  nested `medium`/`large` payloads.
- **null** in a string field isn't distinguished from an empty span (v1 flat data
  has none).
- Wiring an `@eager`/columnar mode into the transform is separate from this
  standalone experiment.

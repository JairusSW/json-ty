# json-ty AS ↔ JS wire protocol (draft)

The format the AS side writes into linear memory and the JS side reads to do
**on-demand** materialization over an in-place JSON buffer. Goal: be
wire-compatible with [json-as](../../json-as)'s dynamic types (`JSON.Value` /
`Obj` / `Arr`) and its `JSON.Types` tag set, while honoring the constraints the
[string-bridge experiment](./string-bridge/README.md) exposed.

## Design rules (from the throughput data)

1. **Cross in bulk, never per-value.** Source bytes in (once), a flat slot tape
   out (once). No per-field boundary calls during indexing.
2. **Index, don't materialize.** The scan records spans; it never builds JS/AS
   strings. String materialization (the 1.7 GB/s wall) happens lazily, per
   getter, only for touched fields.
3. **Scalars are cheap to return; strings are not.** A number/bool getter
   crossing is ~tens of ns. Defer strings hardest.
4. **The base buffer is immutable while a tape is live.** Spans index it
   directly; mutation goes to an overlay; layout is only recomputed at emit.

## Memory regions

The buffer lives in WASM linear memory and is never copied back out wholesale:

```
┌───────────┬──────────────┬───────────────┬───────────────┬───────────────┐
│  SOURCE   │   HEADER     │   SLOT TAPE   │  KEY REGION   │  EDIT OVERLAY │
│ (raw JSON │  fixed, 16B  │ N × u64 slots │ (dynamic only)│ (mutation log)│
│  UTF-8)   │              │               │               │               │
└───────────┴──────────────┴───────────────┴───────────────┴───────────────┘
   immutable base ──────────────────────────┘     append-only ─────────────┘
```

- **SOURCE** — the original JSON, UTF-8, immutable. All spans index into it.
- **HEADER + TAPE** — what a scan produces; JS reads these.
- **KEY REGION** — only for dynamic objects (unknown schema); typed structs omit
  it entirely (slot index ⇒ field).
- **EDIT OVERLAY** — pending width-changing writes; applied once at `bytes()`.

> **Divergence from json-as:** json-as offsets are in **UTF-16 units** (its
> source is a JS string, hence `>> 1` everywhere). Our source is **UTF-8 bytes**,
> so all offsets/lengths below are **byte** offsets — no `>> 1`, and the 2²²
> compact range is **4 MiB of bytes** (not 8 MB of UTF-16 units).

## Header (16 bytes, fixed)

| off | size | field        | meaning                                              |
|----:|-----:|--------------|------------------------------------------------------|
| 0   | u8   | `version`    | format version (start at 1)                          |
| 1   | u8   | `errorCode`  | 0 = ok; else parse/validation error (see codes)      |
| 2   | u8   | `rootType`   | `JSON.Types` of the root (Object/Array/scalar)       |
| 3   | u8   | `flags`      | bit0 = dynamic (keyed) tape, bit1 = validated strict |
| 4   | u32  | `count`      | object ⇒ #fields, array ⇒ #elements, scalar ⇒ 1      |
| 8   | u32  | `faultOff`   | byte offset into SOURCE where parsing failed         |
| 12  | u32  | `tapePtr`    | pointer to slot tape (or 0 if errorCode != 0)        |

`rootType` disambiguates `count`. `faultOff` makes the strict/safe story real
without a second call.

## Slot word (canonical u64, json-as-compatible)

Each slot is one NaN-boxed `u64`, identical in spirit to json-as's value word so
the AS-side `JSON.Value`/`Obj` can consume it directly:

```
bit  63        62 ......... 50  49 .. 45  44       43 ........ 22  21 ........ 0
   ┌────┬──────────────────────┬─────────┬─────┬──────────────────┬──────────────┐
   │box │   qNaN signature     │ tag(5)  │ abs │   length (22)    │  offset (22) │   ← boxed (non-f64)
   └────┴──────────────────────┴─────────┴─────┴──────────────────┴──────────────┘
A real f64 value is stored as its raw IEEE-754 bits (not-NaN ⇒ not boxed).
```

Constants (mirrors json-as `assembly/index.ts`):

| name              | value                  | meaning                                   |
|-------------------|------------------------|-------------------------------------------|
| `VAL_QNAN`        | `0x7ffc000000000000`   | boxed signature; `(w & QNAN)==QNAN`       |
| `VAL_TAG_SHIFT`   | `45`                   | tag occupies bits 45–49 (5 bits)          |
| `VAL_PAYLOAD_MASK`| `0x00001fffffffffff`   | low 45 bits                               |
| `VAL_PTR_MASK`    | `0xffffffff`           | wasm32 pointer (abs form)                  |
| `LZ_FIELD_BITS`   | `22`                   | offset/length field width                 |
| `LZ_FIELD_MASK`   | `0x3fffff`             | `(1<<22)-1` (4 MiB byte range)            |
| `LZ_ABS_FLAG`     | `0x100000000000`       | bit 44: payload is absolute, not compact  |
| `VAL_BOX64`       | `0x8000000000000000`   | bit 63: 64-bit int spilled to heap        |

**Tags = `JSON.Types`** (reuse verbatim): `Null=0, Raw=1, U8..F64=2..11,
Bool=12, String=13, Object=14, Array=15, Map=16, Struct=17, TypedArray=18,
ArrayBuffer=19, Lazy=20`.

**Span payload, two forms** (bit 44 selects):
- **compact** (bit44=0): `(length << 22) | offset`, byte offset & length relative
  to SOURCE base. Exact end, no scan, for any value in a ≤4 MiB source whose own
  length is ≤4 MiB. Relative ⇒ survives buffer relocation. The common case.
- **absolute** (bit44=1): absolute start pointer in low 32 bits; end is scanned
  on demand. Fallback for sources/values past the 4 MiB range.

**Inline scalars** (no span): small ints live directly in the 45-bit payload
(range `[-2⁴⁴, 2⁴⁴)`); larger spill to heap (`VAL_BOX64`). `Bool`/`Null` are
fixed tagged words. Doubles are raw bits.

## Two modes

- **Typed (slotted)** — schema known at compile time. Tape is `count` slots in
  **field order**; slot *i* = field *i*. **No keys cross.** Generated getter for
  field *i* indexes `tape[i]` directly. This is the json-ty fast path.
- **Dynamic (keyed)** — unknown schema (`JSON.Value`/`Obj`). Each slot is paired
  with a **key span** `(keyOff,keyLen)` into SOURCE in the KEY REGION (never a
  copied/length-prefixed key). Lookup: linear scan ≤ 6 keys, FNV-hash index
  above (json-as's `OBJ_LINEAR_MAX`).

## Strings, null, arrays

- **Strings & escapes** — defer unescaping to the getter. Reserve one payload
  bit (or distinguish `Raw` from `String`) as **`needsUnescape`**: clear ⇒ getter
  raw-slices the bytes and UTF-8 decodes; set ⇒ run the unescape pass. The scan
  sets it only when it sees a backslash. Directly attacks the string tax.
- **Null** — no null bit. Detect by peeking the slice: a span of 4 bytes equal to
  `null` is JSON null (json-as's `__lazyIsNull` approach). Saves a bit on every
  slot and a branch in the scanner.
- **Arrays** — the slot is **a span + the element count in `Object/Array` form**,
  *not* N pre-expanded element slots. Element *k* is pulled/scanned on demand
  (cursor), so a 10k-element array costs O(1) to index. Re-entering an array or
  object value builds its child tape lazily on first touch.

## JS-side reader (no BigInt)

Reading u64 NaN-boxed words via BigInt is slow. Read each slot as **two `Uint32`
lanes** over the same memory and extract with shifts. The compact `length` field
straddles the 32-bit lane boundary (bits 22–43), so:

```js
// one view per region, created once after the scan (re-grab if memory grew)
const lo = new Uint32Array(mem.buffer);            // 32-bit lanes
const hi = lo;                                     // same array; index *2 / *2+1
const base = tapePtr >>> 2;                        // u32 index of tape start

function slot(i) {
  const l = lo[base + i * 2];                       // bits 0..31
  const h = lo[base + i * 2 + 1];                   // bits 32..63
  const boxed = (h & 0x7ffc0000) === 0x7ffc0000;    // qNaN signature in hi lane
  if (!boxed) return { tag: T.F64, f64: /* read as Float64 */ 0 }; // raw double
  const tag = (h >>> 13) & 0x1f;                    // bits 45..49
  const abs = (h & 0x00001000) !== 0;               // bit 44
  const offset = l & 0x3fffff;                      // bits 0..21
  const length = (l >>> 22) | ((h & 0xfff) << 10);  // bits 22..43 (straddles)
  return { tag, abs, offset, length };
}
```

Then materialize against the SOURCE bytes:
`const v = decodeUtf8(srcBytes.subarray(srcBase + offset, srcBase + offset + length))`
— and skip `decodeUtf8`'s unescape branch when `needsUnescape` is clear.

> **Optional JS-friendly typed-mode slot.** The straddle exists only to stay
> bit-identical to json-as's `Value` word. The **typed path never goes through
> `Value`** (getters index by slot), so it may instead use a simpler
> non-straddling layout — e.g. `lane0 = offset_u32`, `lane1 = (tag << 24) |
> length` — trading json-as word-compatibility (irrelevant on that path) for a
> 2-op JS read. Keep the canonical u64 for the dynamic path only.

## Lifetime & mutation invariants (load-bearing)

- A tape's spans are valid **only while SOURCE is unchanged**. The owner of the
  buffer is the GC anchor (json-as keeps a `src` ref traced by `__visit`).
- **Reads** consult the EDIT OVERLAY first, then the tape → SOURCE.
- **Same-width writes** patch SOURCE in place; spans unchanged.
- **Width-changing writes / inserts / deletes** append to the OVERLAY; SOURCE and
  tape are untouched, so no offset goes stale mid-session.
- **`bytes()`** walks the doc once, splicing overlay edits while copying out — N
  edits ⇒ one compaction, not N memmoves. After compaction the tape is rebuilt
  (or discarded). **Never mutate SOURCE under a live tape with width changes.**

## Error codes (draft)

`0` ok · `1` unexpected token · `2` unterminated string · `3` bad number ·
`4` bad escape · `5` invalid UTF-8 · `6` depth limit · `7` trailing garbage.
`faultOff` carries the byte offset.

## Open questions

- Compact range is 4 MiB (bytes). Bump `LZ_FIELD_BITS`/use a wider slot for big
  docs, or accept the absolute-form scan cost past 4 MiB?
- Strict validation (UTF-8 + structure) eagerly during scan (33 GB/s lane, sets
  `validated` flag) vs trust-untouched-bytes for max speed — per-call option?
- Array cursor: resumable (store last element ptr) vs rescan-from-start per
  index? Resumable wins for sequential iteration, costs a cursor slot.
- Does WASM earn the copy-in here at all, or is lazy-in-pure-JS the win for
  JS-string input? → the break-even experiment still decides this.

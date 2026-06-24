# json-ty architecture

A drop-in `JSON.parse<T>` / `JSON.stringify<T>` for TypeScript, backed by one
schema-directed WASM parser that materializes JSON into **flat, pointer-linked
tables** the JS side reads through typed arrays. Distilled from the
`experiments/` findings into a single recommended implementation.

---

## 1. The decision

**One core engine: the eager flat-table parser.** It was the broad winner across
every experiment, and one buffer serves three read facets. The alternative — the
lazy NaN-boxed/`decodeSlot` engine — is **dropped from the core**: its only
advantage (reading a few fields of a huge doc) is narrow, and it *lost* full
deserialize because every getter allocated a `{tag,off,len}` object + a memo
`Map`. The eager engine beats it everywhere that matters and is far simpler.

Critically, the eager core is still **on-demand where it counts**: it parses the
*skeleton* (structure + numbers/bools) eagerly in one pass, but **strings stay as
byte spans and nested values stay as pointers** — both are materialized only when
a getter touches them. That gives the lazy vision's payoff (don't pay for strings
you don't read) without the lazy engine's per-access allocation tax.

> Measured (full deserialize, read every field, vs native `JSON.parse`): small
> 1.3–1.8×, medium 1.3–1.9×, large 1.1–1.3×; bulk numeric ~1.9×; serialize
> ~1.1–1.5×. Partial reads are strictly cheaper (unread strings/children cost
> nothing). 24,000 fuzz cases match native exactly.

### One parse, three read facets (the whole point)

```
                       ┌─ object view    JSON.parse<T>(x).field        (getters)
flat tables in WASM ───┼─ columnar       parseColumnar(x).numCol(i)    (Float64Array)
   (one parse)         └─ mutable doc    parseDoc(x).set(k,v).emit()   (span splice)
```

All three read the *same* contiguous buffer; no re-parse to switch facets.

---

## 2. Public API

```ts
import { JSON } from "json-ty";

@json class Vec3   { x!: f64; y!: f64; z!: f64; }
@json class Player { name!: string; age!: i32; pos!: Vec3 | null; tags!: string[]; }

const p = JSON.parse<Player>(bytesOrString);   // typed view; satisfies Player
p.age;      // number — read straight from the buffer
p.name;     // string — sliced/unescaped from its span on access (then cached)
p.pos?.x;   // nested — child view via pointer, on access
p.tags;     // string[] — materialized on access

JSON.stringify<Player>(p);                     // pure-JS serialize (beats native)
JSON.from(Player, { ... });                    // wrap a plain object for stringify

// Optional facets over the same engine (arrays of flat records):
const df  = JSON.columns<Row>(jsonArray);      // df.numCol(i) -> Float64Array, df.sum(i), df.strCol(i)
const doc = JSON.doc<Config>(jsonObject);      // doc.set("k", v).emit(); doc.get("k")
```

- `JSON.parse<T>(input: Uint8Array | string): T` — returns a `T`-typed view.
  Bytes input is the sweet spot (no transcode); a JS string is bulk-copied in.
- `JSON.parse<T[]>(input): T[]` — array of row-views over one table.
- Decorators carry over (`@alias` `@omit` `@omitnull` …). There is **no
  `@eager` / `@lazy` toggle** — the single engine already is eager-skeleton +
  lazy-materialization.

---

## 3. Wire format (the buffer the JS side reads)

Every value level is a **contiguous table**, schema-directed so there are **no key
spans** — field *i* lives at a fixed slot:

```
table  = [ count u32 ][ M u32 ]  then  count * M  slots        (8 bytes each, row-major)
object = table with count = 1
array of records (struct[]) = count = N
primitive array (T[])       = M = 1, one element per row
```

**Slot (8 bytes), interpreted by the field's statically-known kind:**

| kind            | encoding                                                              |
|-----------------|----------------------------------------------------------------------|
| number / bool   | raw `f64` (bool = 0.0 / 1.0)                                          |
| string          | `off u32` (byte offset into source) · `len u32` with two flag bits   |
| object / array  | `u32` **pointer** to the child table's region (0 = null)             |
| null            | number/bool → `f64 NaN`; string → `len` null-bit; nested → ptr `0`   |

**String `len` high bits** (length itself is < 2²⁴, so the top bits are free):
- bit 31 = **escaped** — the span contained a `\`; the reader runs one unescape
  pass (`JSON.parse('"'+raw+'"')`). Clean strings skip it (pure slice).
- bit 30 = **null** — the field was `null` (distinct from `""`).

Nesting is **pointers, not inlining**: a nested object/array is its own table and
the parent slot holds its region pointer — so navigation is a typed-array read,
never a re-parse.

**Schema descriptor** (one `registerSchema` per `@json` class):
`count × [ keyLen u32 ][ key bytes ][ childSid i32 ]`, where `childSid` is `-2`
(leaf scalar/string), `-1` (primitive array), or a child schema id.

---

## 4. WASM engine (`src/wasm/eager.ts` → `eager.wasm`)

One prebuilt, committed `.wasm`; consumers never run `asc`. Built:
`--runtime stub --enable simd --enable bulk-memory --bindings raw --exportRuntime -O3 --noAssert`.

### Memory

```
SRC   StaticArray<u8>  (16 MB)   input bytes, written once per parse; stays resident
ARENA StaticArray<u8>  (64 MB)   output tables; `bump` allocator, reset per parse
TMP   StaticArray<u64> (1 M)     side-stack: buffers an array's records so siblings
                                 stay contiguous while a nested child allocates in ARENA
```

The **source stays resident** — string slots index it in place; only touched
strings are ever materialized.

### Kernels (proven; reuse as-is)

- `parseF64` — Clinger fast path (POW10 table; exact ≤ 2⁵³ mantissa, |exp| ≤ 22).
- `skipString` — SIMD scan for `"`/`\` (`v128` 16-byte stride); sets the
  **escape flag** when it passes a `\`.
- `scanComposite` — depth scan to a matching `}`/`]` (skips quoted strings).
- `matchKey` — **hybrid**: linear scan for ≤16-field schemas, O(1)
  open-addressing **FNV hash** above (built in `registerSchema`). Big win for
  wide objects without taxing small ones.

### Parse functions (recursion lives entirely in WASM)

- `objTable(sid)` — single record; reserves M slots, then fills (children alloc
  after, so the record stays contiguous).
- `arrTable(elemSid)` — array of records; buffers rows in `TMP` so they stay
  contiguous despite nested allocations, then one `memory.copy` into ARENA.
  **Flat fast path:** element schemas with no sub-tables write straight to ARENA.
- `primTable` — primitive array (`M = 1`).
- `spanObject(sid)` — mutable-doc facet: records each top-level field's **value
  byte span** `(off,len)` instead of its value (for `parseDoc`).

### Exports

```
srcPtr() -> ptr                       // input write address
registerSchema(descPtr, count) -> sid // descriptor above; builds keys + hash + flat flag
resetSchemas()                        // free the fixed-size schema registry (reuse slots)
parseEagerObject(sid, len) -> region  // JSON.parse<T>
parseEagerArray(elemSid, len) -> region // JSON.parse<T[]>
spanObject(sid, len) -> region        // JSON.doc
memory
```

**One WASM call per parse.** No JS callbacks during a parse — the per-call
boundary is exactly what we avoid (measured: per-value crossings are the wall).

---

## 5. JS runtime (`src/wasm/runtime.js`)

Instantiate once; cache `u8`/`u32`/`f64`/`DataView`/`Buffer` views (re-grab after
any `memory.grow`).

- **`writeInput(input)`** — string → `Buffer.write(input, SRC, "utf8")` (Node,
  ~55 GB/s); bytes → `u8.set`. Records `asciiSource` when the write was pure
  ASCII (byteLen === input.length) to enable the slice-original fast path.
- **`registerSchema(keys, childSids)`** — writes the descriptor via
  `DataView.setUint32`/`setInt32` (unaligned-safe), returns the sid.
- **View factory** (emitted target of the transform). Each view caches its row
  base at construction so a getter is a single typed-array read:

  ```js
  class V {
    constructor(region, row = 0) {
      const M = u32[(region >>> 2) + 1];
      this._fb = ((region + 8) >>> 3) + row * M;       // f64 base index
      this._ub = ((region + 8) >>> 2) + row * M * 2;   // u32 base index
    }
    get age()  { return f64[this._fb + 1]; }                          // number
    get name() { return readStr(this._ub + 2*2); }                   // string span
    get pos()  { const p = u32[this._ub + 3*2]; return p ? new V_Vec3(p) : null; } // child ptr
  }
  ```
- **`readStr(j)`** — `off = u32[j]`, `raw = u32[j+1]`; if null-bit → `null`;
  `s = asciiSource ? asciiSource.slice(off,off+len) : nbuf.toString("utf8", SRC+off, …)`;
  if escape-bit → `JSON.parse('"'+s+'"')`. Strings are cached per field on the view.
- **Columnar facet** — `parseColumnar(sid, input)` over `parseEagerArray`:
  `numCol(i)` copies a strided column into a packed `Float64Array`; `sum`/
  `countWhere` stride in place; `strCol`. (Value = parse speed + zero-copy
  typed-array interop; **not** faster than V8 at scalar JS loops.)
- **Mutable-doc facet** — `parseDoc(keys, json)` over `spanObject`: `set(k,v)`
  records an edit; `emit()` splices the source `[prefix][newValue][suffix]`.
  **Splice the byte `Buffer`, not the JS string**, so UTF-8 stays correct (byte
  spans ≠ char offsets); decode once at the end.

---

## 6. Serialize — pure JS (unchanged, `src/serialize/`)

WASM can't help: getting a JS object *into* WASM is per-field and loses, and the
existing codegen already beats native `JSON.stringify` (~1.1–1.5×). The transform
keeps emitting `__JSON_SERIALIZE` per class. `JSON.stringify<T>` / `JSON.from`
stay JS-only.

---

## 7. The `@json` transform (`transform/`)

Per `@json class T`, the transform (AST, build-time) emits:

1. `registerSchema` call → `__sid`, and a **view factory call** with the field
   spec `{ prop: [kind, slotIndex, childName?] }` (kinds: `num/bool/str/child/
   structArray/numArray/strArray`) + `childSids`. Data-only codegen (no `this`,
   synthesized nodes at pos/end −1 — see the existing transform).
2. Rewrites `JSON.parse<T>(x)` → `parseEager(__View_T.__sid, __View_T, x)` and
   `JSON.parse<T[]>(x)` → `parseEagerArrViews(...)`.
3. Null-aware getters **only** for fields typed `T | null` (check NaN / null-bit /
   ptr 0); non-nullable fields get the fast path.
4. Serialize codegen, unchanged.

---

## 8. Memory & lifecycle

- One shared WASM instance per module. Each parse resets `bump` (no GC churn) and
  reuses `SRC` — so **a new parse invalidates the previous parse's views**
  (documented; detach via `structuredClone`/`.toJSON()` if you must keep one).
- `resetSchemas()` frees the fixed registry (256 schemas / 4096 fields / 64 KB
  keys); call it if an app registers schemas dynamically in a loop.
- Views never escape to the WASM heap; they hold only integer base indices + the
  shared typed-array views.

---

## 9. Correctness

- **Fuzzer** (`experiments/fuzz`): random schemas + JSON (escapes, unicode/emoji,
  edge numbers, deep nesting) diffed against native, full recursive read. Keep it
  as the regression gate — it already caught the eager string-unescape bug.
  Target: 0 diffs over ≥10⁴ cases on every change.
- **Null**: must be encoded distinctly (NaN / len null-bit / ptr 0) — do **not**
  ship the zero-bytes shortcut (it conflates `null` and `""`). The transform
  knows nullability from the type, so the cost lands only on `T | null` fields.

---

## 10. Scope

- **In:** top-level object & array-of-records; `number/i32/f64/bool/string`
  fields; nested objects; `number[]`/`int[]`/`string[]`; struct arrays; lazy
  string/child materialization; columnar + mutable-doc facets; pure-JS serialize.
- **Deferred (only if a real workload demands it):**
  - *Byte-streaming emit* (`writev` of `[prefix][value][suffix]` from the buffer)
    — the path past mutable-doc's O(size) JS-string wall.
  - *Skip-scan partial mode* — for reading a couple of fields out of multi-MB
    docs, a variant that scans only to the requested field. The current engine
    parses the whole skeleton (still ~1.3–1.9× native), so add this only if that
    access pattern dominates.
  - *Browser glue* — `encodeInto`/`TextDecoder` in place of `Buffer` (the engine
    is unchanged; only `writeInput`/`readStr` swap paths).
- **Non-goal:** beating native at scalar JS `for`-loops over already-parsed data —
  V8's monomorphic object access already wins that; json-ty's edge is parse
  throughput, lazy string materialization, typed-array interop, and near-zero
  allocation.

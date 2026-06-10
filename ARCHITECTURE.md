# json-ty architecture

Lazy, on-demand JSON parsing backed by a SIMD WASM stage-1 index, behind a
drop-in `JSON.parse<T>` / `JSON.stringify<T>` API. Grounded in the
`experiments/` findings (see `experiments/*/README.md`).

## Locked decisions (v1)

- **Shape:** lazy on-demand parse. Scalars eager (parsed in WASM), strings &
  nested objects/arrays lazy (materialized in JS on first access, memoized).
- **API:** drop-in `JSON.parse<T>(input): T` / `JSON.stringify<T>(value): string`,
  json-as-style — users just `import { JSON } from "json-ty"`.
- **Packaging:** one prebuilt generic runtime `.wasm` shipped with the package;
  the transform emits JS glue per schema. No `asc` in consumer builds.
- **Target:** Node-first (`Buffer.write` / `Buffer.toString` fast paths). Browser
  (`encodeInto`/`TextDecoder`) is a later fallback.
- **Serialize stays pure-JS** (today's codegen already beats native; WASM can't
  help — getting a JS object *into* WASM is per-field and loses).

## Why this split (from the experiments)

| fact (measured) | consequence |
|---|---|
| bulk copy-in is ~free (Node `Buffer.write` 55 GB/s) | copy the whole source into WASM in one call |
| per-value crossing + string materialize is the wall (~1.7 GB/s) | never cross per value; defer string decode to JS, memoize |
| SIMD stage-1 index ~3.1× native full parse | tokenize/index in WASM |
| eager scalar parse ~2.2× native | parse numbers/bools/null in WASM, return values |
| fully materializing a string-heavy object ≈ ties native | only materialize what's touched → lazy |
| serialize-from-JS-object already beats native in JS | keep serialize in JS |

## Component map

```
src/
  index.ts            JSON namespace: parse<T>, stringify<T>, from
  serialize/          pure-JS serializers (unchanged) — stringify path
  wasm/
    parser.ts         AS source: copy-in target + SIMD tokenize + eager scalars -> tape
    parser.wasm       prebuilt, committed (consumers don't run asc)
    runtime.js        Node loader: instantiate, reserve/copy-in, reset, typed views
  view.js             lazy view base: slot decode (2-lane), string/nested materialize + memo
transform/            emits, per @json class, a View subclass + parse wiring
```

## Public interface

```ts
import { JSON } from "json-ty";

@json class Player { name!: string; age!: int; pos!: Vec3 | null; }

const p = JSON.parse<Player>(bytesOrString); // typed view; scalars ready, strings/nested lazy
p.age;        // eager scalar — read straight from the tape
p.name;       // string — decoded from its span on first access, then cached
p.pos?.x;     // nested — child view built on first access

JSON.stringify<Player>(p);                    // pure-JS serialize (unchanged)
```

- `JSON.parse<T>(input: Uint8Array | string): T` — returns a `T`-typed **view**.
  Property reads are transparent; the object satisfies the `T` interface.
- Input may be bytes (zero transcode — the sweet spot) or a JS string (Node
  `Buffer.write` into WASM).
- Decorators unchanged (`@alias` `@omit` `@omitnull` `@omitif`) plus
  `@json({ eager: true })` to force full materialization (returns a plain
  instance, e.g. for structural-clone / `Object.keys` use).

### View semantics (must document for users)

- **Scalars** (`number`/`int`/`boolean`, `null`): eager — already parsed.
- **Strings**: decoded lazily, **memoized** on first read.
- **Nested object/array**: a child view, built lazily on first access.
- **Lifetime:** a view holds the parse's tape + the source buffer. Valid until
  the next `JSON.parse` on the same instance reuses the arena (single shared
  instance, see Memory). Reading a stale view is a documented misuse; an
  `@eager` parse or `.toJSON()`/structuredClone detaches if you need to keep it.

## Wire format (tape)

Per `experiments/PROTOCOL.md`. v1 concretes:

- **Header** (16 B at a fixed offset): `version u8`, `errorCode u8`,
  `rootType u8` (JSON.Types), `flags u8`, `count u32`, `faultOffset u32`,
  `tapePtr u32`.
- **Slot** = `u64`, json-as-compatible NaN-box:
  - real `f64` → raw IEEE bits (scalars parsed eager land here).
  - boxed → `qNaN | tag<<45 | payload`; tag = `JSON.Types`
    (`Null/Bool/String/Object/Array/Raw/...`).
  - string/object/array payload = span, compact `(len<<22)|offset` (byte
    offsets, ≤4 MiB) or absolute fallback (bit 44).
- **JS reads slots as two `Uint32` lanes** (no BigInt): `lo`/`hi`, extract
  `tag = (hi>>>13)&0x1f`, `offset = lo&0x3fffff`,
  `len = (lo>>>22)|((hi&0xfff)<<10)`. (Verified in PROTOCOL.md.)
- Strings carry a **needs-unescape bit**; clean strings raw-slice + decode, only
  escaped ones run the unescape pass.

## Memory model

- One `WebAssembly.Memory`, grown on demand; JS re-grabs `Uint8Array` /
  `Uint32Array` / `Float64Array` views after any grow.
- Regions: `[ input bytes | tape | (string scratch, only for @eager) ]`.
- **Source stays resident** — spans index it in place; nothing copied back for
  scalars; strings sliced from it on access.
- **Resettable arena:** the runtime owns the buffer lifecycle, so each
  `JSON.parse` resets the bump pointer (no GC). One shared instance per module;
  a parse invalidates the previous parse's views (documented).

## Exported WASM functions

```
reserve(nbytes: u32) -> ptr        // ensure input capacity, return write ptr (grows mem)
parse(len: u32) -> errorCode       // tokenize + eager-scalar -> tape; fills header
tapePtr() -> ptr                   // base of slot tape
count() -> u32                     // top-level member/element count
enter(start: u32, end: u32) -> ptr // build a child tape over a sub-span (lazy nesting)
reset()                            // reset arena bump pointer
memory                             // exported
```

## Host functions (JS → WASM imports)

**None** beyond `abort` (or compile `--use abort=` to drop it). No JS callbacks
during a parse — per-call crossings are exactly what we avoid. Everything the
parser needs is in linear memory.

## Parse data flow

1. JS `reserve(len)` → `ptr`; `Buffer.write(input, ptr, "utf8")` (or `set` for
   bytes input) — one bulk copy.
2. `parse(len)` → WASM SIMD-tokenizes (bitmask+ctz), eager-parses every scalar
   into the tape, records strings/objects/arrays as span slots, writes header.
   Returns `errorCode` (+ `faultOffset` in header) → JS throws `SyntaxError` on ≠0.
3. JS constructs the generated `View`: a one-pass walk resolves each known
   schema field to its tape slot (key match; ≤N keys → linear). Stores slot
   indices on the instance.
4. Getters: scalar → read slot; string → slice source span + decode (memoized);
   nested → `enter(span)` child view (lazy, memoized).

## Transform responsibilities

For each `@json class T`, generate:
- a `View_T` class implementing `T` with per-field getters (scalar read / lazy
  string / lazy child view), keyed by the field's JSON name (or `@alias`).
- the constructor walk that resolves fields → slots once.
- `JSON.parse<T>` dispatch → `new View_T(runtime.parse(input))`.
- (serialize unchanged: existing `__JSON_SERIALIZE`.)

## v1 scope / non-goals

- **In:** top-level object; scalar + string fields; nested objects; `number[]`,
  `int[]`, `string[]`, `boolean[]`; lazy strings/nested; `@eager`.
- **Later (v2+):** mutable in-place document (edit + emit, pass-through);
  object/array-of-objects lazy element cursors for huge arrays; browser fallback
  glue; dynamic `JSON.Value`/`Obj` over the same tape.
- **Non-goal v1:** beating native on *fully-materialized* string-heavy parses —
  the win is partial access + bytes-in.

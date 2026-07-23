# json-ty implementation plan

## 1. Objective

Build a TypeScript-only, schema-directed replacement for the basic forms of:

```ts
JSON.parse<T>(input)
JSON.stringify<T>(value)
```

The implementation will generate a schema-specialized AssemblyScript module,
compile it to WebAssembly, and generate matching high-performance JavaScript
bindings. WebAssembly will parse and serialize raw UTF-8 bytes only. Parsed
data will live in a flat graph in WebAssembly linear memory and will be exposed
to TypeScript through strongly typed generated views.

The project should reproduce the useful type coverage, decorators, correctness,
and optimizations of `json-as`, adapted to a raw UTF-8 and flat-memory model.
The target is resident-kernel performance at least comparable to `json-as`,
while keeping the Node.js end-to-end boundary overhead small enough to beat the
built-in JSON implementation on the workloads suited to schema-directed code.

Breaking the existing `json-ty` implementation is allowed. Existing experiments,
fuzzers, payloads, and proven algorithms should be retained as research and
regression assets.

### Current implementation checkpoint (2026-07-18)

The fresh architecture in this plan is implemented through the generated
compiler, raw stub-runtime Wasm library, custom Node/browser bindings, typed
views, dynamic facades, decorators, classic benchmarks, and chart pipeline.
The direct SIMD comparison passes all 12 json-as parse/serialize kernel gates
at the required 0.90x floor; the smallest parser is 1.08x and the large corpus
parsers are 1.43x-2.16x. The complete test, RFC, differential fuzz, scalar, ABI,
compiler, and build/cache suites pass. See
`benchmark/results/core-port-2026-07-18.md` for the reproducible matrix and the
one deliberately reported host-lifecycle caveat on tiny parse/release pairs.

On-demand typed parsing is implemented in schema IR v5. Class policies
support `none`, `auto`, and `all`; field `@lazy`/`@eager` and `JSON.Lazy<T>`
override them. Deferred non-string fields remain validated UTF-8 source ranges
until one generated Wasm materializer call on first access, then cache in their
flat slot. Untouched fields serialize from the original range. Strings retain
the existing first-read decode cache. The SIMD and scalar differential fuzz,
RFC suite, generated-project integration, mutation, invalid deferred shape, and
one-call boundary tests cover this path; `npm run bench:lazy` records the access
matrix.

## 2. Fixed decisions

### 2.1 Public scope

The optimized API is limited to:

```ts
JSON.parse<T>(input: string | Buffer | Uint8Array): T
JSON.stringify<T>(value: T): string
```

There is no optimized support for a reviver, replacer, or pretty-print spacing.
Untyped or unsupported calls may fall back to the native JSON implementation.

### 2.2 Target environment

- Node.js is the first and primary performance target.
- Use `Buffer` directly when it is available.
- Browser support will reuse the same Wasm core with a different byte bridge.
- The default build requires WebAssembly SIMD and bulk memory.
- Scalar and SWAR implementations remain correctness references and potential
  compatibility fallbacks.

### 2.3 AssemblyScript constraints

The generated AssemblyScript module and its backing library operate exclusively
on raw bytes, numeric values, offsets, and WebAssembly memory.

The hot path must not use:

- AssemblyScript `string`
- `Array<T>` or `StaticArray<T>`
- `Map`, `Set`, or `ArrayBuffer`
- managed classes or managed allocations
- the AssemblyScript GC
- exceptions for parse failures
- generated AssemblyScript loader bindings

`@unmanaged` declarations may be used to document layouts, but runtime objects
are manually allocated memory regions. Code must not use `new` to construct an
object graph.

Initial compiler flags:

```text
--runtime stub
--importMemory
--enable simd
--enable bulk-memory
--optimizeLevel 3
--shrinkLevel 0
--noAssert
```

Do not ask `asc` to emit JavaScript bindings. The project supplies its own raw,
schema-specific binding and instantiates the module directly.

The final release configuration must be selected through benchmarks, including
`-O2` versus `-O3` build-time and runtime tradeoffs.

### 2.4 Encoding

- The internal source and output encoding is UTF-8.
- Node string input is written directly into Wasm memory with
  `Buffer.write(input, offset, "utf8")`.
- `Buffer` and `Uint8Array` input is copied directly as bytes.
- Output is returned with `Buffer.toString("utf8", start, end)`.
- The parser validates UTF-8 and JSON syntax.
- A rare compatibility path must preserve the behavior of ill-formed JavaScript
  UTF-16 strings containing unpaired surrogates without slowing the normal
  well-formed UTF-8 path. This may be a UTF-16 fallback entry point or a small
  WTF-8 bridge, selected by benchmark and complexity.

Direct Node measurements favored UTF-8 copy plus SIMD scanning by approximately
2x over direct UTF-16LE at 1 KiB and larger inputs. The UTF-8 resident scan also
processed approximately twice as many logical JSON characters per second.

### 2.5 Compatibility model

- Typed objects should resemble ordinary parsed JavaScript objects as closely
  as practical.
- `T[]` returns a real JavaScript `Array`.
- `JSON.Array<T>` is an opt-in zero-copy array facade.
- `JSON.Obj`, `JSON.Arr`, and `JSON.Value` are opt-in dynamic facades.
- Constructors are not invoked during parsing.
- Parsed class views use the class prototype when it is safe to do so.
- Unknown decorators are preserved and emitted normally.
- Fields affected by unknown runtime decorators may become host-managed slow
  fields instead of silently losing the decorator's behavior.

## 3. Package architecture

The fresh implementation should be divided into independent layers with a
single schema IR between them.

```text
packages or source areas
├── compiler
│   ├── TypeScript program analysis
│   ├── schema IR
│   ├── decorator analysis
│   ├── AssemblyScript code generation
│   ├── JavaScript binding/view generation
│   └── call-site transformation
├── assembly
│   ├── raw parser kernels
│   ├── raw serializer kernels
│   ├── scratch/document memory
│   └── dynamic JSON runtime
├── runtime
│   ├── common document/view support
│   ├── Node Buffer binding
│   └── browser byte binding
└── generated
    ├── schema IR manifest
    ├── application-specific AS source
    ├── application-specific Wasm
    └── application-specific TS/JS bindings
```

The AssemblyScript backend and JavaScript backend must be generated from the
same normalized schema IR. Serialization behavior, field order, aliases,
defaults, nullability, and decorators must not be separately hand-maintained.

## 4. Compiler and build pipeline

### 4.1 Build orchestration

The canonical integration is the `json-ty/transform` ts-patch v4 source
transformer running on the TypeScript 6 JavaScript compiler. It composes with
other `compilerOptions.plugins` entries in configured order. `json-tyc` remains
a standalone fallback using the same analyzer, generators, cache, and call
transformer.

The build pipeline is:

1. Create a TypeScript `Program` and `TypeChecker`.
2. Discover explicit `@json` classes and erased `JSON.schema<T>()` markers
   reachable from optimized
   `JSON.parse<T>` and `JSON.stringify<T>` calls.
3. Resolve aliases, imports, inheritance, generics, decorators, and the complete
   transitive type graph.
4. Validate the graph and emit precise compile-time diagnostics for unsupported
   types or ambiguous behavior.
5. Normalize the graph into a canonical schema IR.
6. Hash the schema IR, compiler versions, target, and optimization flags.
7. Reuse cached generated artifacts when the hash is unchanged.
8. Generate one application-specific AssemblyScript entry module.
9. Compile it with `asc`: asynchronously in `json-tyc`, or through a
   synchronous child process on a ts-patch cache miss.
10. Generate the Node binding, typed views, facade classes, and schema manifest.
11. Rewrite optimized JSON calls to direct generated binding calls.
12. Emit the user's JavaScript and declaration files.

Bundler adapters for Vite, Rollup, esbuild, and webpack can invoke the same
compiler pipeline. They must not implement a separate schema analyzer.

### 4.2 Module granularity

Start with one Wasm module per TypeScript build target. Do not create one module
per type: that would duplicate memory, initialization, static tables, and input
copies. Code-split modules can be investigated after correctness and module-size
measurements exist.

### 4.3 Schema discovery

- Decorated classes provide explicit schemas and decorator metadata.
- Interfaces and type aliases use the erased `JSON.schema<T>()` marker; merely
  referencing a structured type never opts it into serialization accidentally.
- Interfaces initially use ordinary property names and TypeScript optionality;
  richer metadata may be supplied through a separate typed schema configuration.
- Decorator symbols must be resolved to their imports. Textual names alone are
  insufficient and can collide with user decorators.
- Published dependencies that need decorators should eventually publish a small
  schema manifest because decorator metadata is not reliably present in `.d.ts`
  files.

### 4.4 Type policy

The compiler must be strict. It should reject unsafe or ambiguous schemas rather
than silently generating a generic slow path.

Initial typed support:

- `number`, `boolean`, and `string`
- `null` and nullable fields
- optional fields and declared defaults
- nested classes, interfaces, and object types
- typed arrays of supported values
- tuples where every position is statically known
- string and numeric literal types
- enums with defined JSON representations
- recursive types with a runtime depth limit
- discriminated unions

Later compatibility support, guided by `json-as`:

- `Date`
- `Map<string, T>` and `Set<T>` through explicit policies
- typed arrays and raw byte buffers
- `JSON.Raw`
- generic schemas with concrete instantiations
- custom codecs

Unconstrained `any`, functions, symbols, arbitrary untagged unions, and index
signatures should require an explicit dynamic JSON type.

## 5. Raw Wasm ABI and custom binding

Do not use `@assemblyscript/loader`. Generate a minimal binding specifically for
the compiled schema module.

### 5.1 Memory ownership

JavaScript constructs and imports `WebAssembly.Memory`. The binding ensures
capacity before a call, grows memory if necessary, and refreshes every cached
view after growth.

Cache exactly one of each required host view:

- Node `Buffer`
- `Uint8Array`
- `Uint32Array`
- `Int32Array`
- `Float32Array`
- `Float64Array`
- `DataView` only where unaligned or mixed access requires it

The binding caches direct references to hot exports. It must not repeatedly
traverse `instance.exports`, construct argument objects, or allocate result
objects in the hot path.

### 5.2 ABI rules

- Cross the JS/Wasm boundary once per normal parse or stringify.
- Use only `u32`, `i32`, `f32`, and `f64` parameters and results.
- Avoid exported `i64` values because JavaScript represents them as `BigInt`.
- Return a pointer or status word and place additional results in a fixed result
  header in memory.
- Report insufficient capacity as a recoverable status containing the required
  size. The binding grows memory, refreshes views, and retries once.
- The expected path should pre-size accurately enough to avoid retries.

Proposed result header:

| Offset | Field | Type |
|---:|---|---|
| 0 | status | `u32` |
| 4 | fault byte offset | `u32` |
| 8 | root relative offset | `u32` |
| 12 | document absolute offset | `u32` |
| 16 | document byte length | `u32` |
| 20 | output absolute offset | `u32` |
| 24 | output byte length | `u32` |
| 28 | required capacity | `u32` |

The concrete header may change after profiling, but successful calls must not
require follow-up Wasm calls to retrieve metadata.

### 5.3 Initialization

- Node loads precompiled bytes and constructs `WebAssembly.Module` and
  `WebAssembly.Instance` synchronously.
- ESM and CommonJS packaging both expose a synchronous JSON API after module
  initialization.
- Cold compile and instantiation costs are measured separately from steady-state
  parse throughput.

## 6. Memory system

### 6.1 Regions

```text
WebAssembly.Memory
├── static data
│   ├── encoded keys
│   ├── SIMD/SWAR tables
│   └── default record templates
├── fixed result/control area
├── reusable operation scratch
└── persistent document heap
```

The stub runtime is not the document allocator. Implement a dedicated allocator
for persistent document blocks and a resettable bump allocator for scratch.

### 6.2 Parse and commit

1. The binding reserves enough scratch for input and predicted output.
2. It writes the input bytes directly into the source portion of scratch.
3. The generated parser creates a flat temporary document with a bump allocator.
4. Every reference is relative to the temporary document base.
5. On success, the document allocator reserves one exact persistent block.
6. One `memory.copy` commits the source and graph.
7. The relative offsets remain valid without fixups.
8. Scratch resets.

If compaction proves measurable for very small documents, benchmark an alternate
direct-allocation fast path. Preserve the contiguous committed format either
way.

### 6.3 Document lifetime

The JavaScript `Document` object holds:

- the Wasm runtime instance
- the document base and length
- a generation/disposed flag
- cached decoded values and host overlays

Nested views hold the same `Document`, ensuring the memory remains live. Provide
an explicit `dispose()` and use `FinalizationRegistry` only as best-effort
cleanup. A released document must fail safely if a stale view is used.

The allocator begins with size-class free lists and block coalescing. Fragmentation,
peak memory, allocation latency, and reuse behavior must be benchmarked before
adding a more elaborate allocator.

## 7. Flat document layout

### 7.1 General rules

- All references are document-relative `u32` byte offsets.
- Typed records use schema-specific layouts.
- Fields are aligned for the host typed-array access that reads them.
- Typed fields do not carry dynamic type tags.
- Presence, null, and dirty state use separate bitmaps.
- Source string spans remain raw until accessed or changed.

### 7.2 Typed record

A generated record is conceptually:

```text
Record<T>
├── presence bitmap
├── null bitmap
├── dirty/overlay bitmap
└── aligned field area
    ├── f64 number
    ├── byte/bit boolean
    ├── StringRef
    ├── ObjectRef
    └── ArrayRef
```

Proposed references:

```text
StringRef = offset:u32 + lengthAndFlags:u32
ObjectRef = offset:u32
ArrayRef  = offset:u32 + length:u32
```

String flags distinguish source versus arena storage, escaped versus clean
source, null where applicable, and any cached serialization classification.
The exact bit allocation is decided only after maximum-length and large-document
tests.

### 7.3 Arrays

- Primitive arrays are contiguous and naturally aligned.
- Boolean arrays benchmark byte-per-value against packed bits.
- String arrays contain contiguous `StringRef` records.
- Flat struct arrays contain fixed-stride records.
- Variable nested records contain contiguous relative offsets.
- Array headers contain element kind, length, capacity where mutable in Wasm,
  and data offset.

### 7.4 Dynamic values

Dynamic JSON initially uses an explicit 16-byte slot rather than NaN boxing:

```text
tag:u32 | flags/aux:u32 | payloadLo:u32 | payloadHi:u32
```

This supports raw `f64` payloads and references without requiring BigInt reads
or colliding with NaN encodings. Benchmark memory bandwidth and size against a
two-lane NaN-boxed alternative before freezing the public document format.

### 7.5 Defaults

Generate a static default byte template for every eligible schema. Record
initialization becomes one `memory.copy`, followed by overwriting present input
fields. Defaults that cannot be evaluated safely at compile time are either
host-managed or rejected with a diagnostic.

After the general template path works, add `json-as`'s exact-default-document
matcher only where benchmarks show an additional benefit.

## 8. Parsing architecture

### 8.1 Typed path

The generated typed parser is a schema-directed single pass. It writes values
directly to known field offsets and does not create a generic token stream.

Per schema, generate:

1. A canonical ordered/minified fast path.
2. A whitespace-tolerant ordered path where profitable.
3. A correct arbitrary-order fallback.

The general fallback performs length-bucketed key dispatch, packed comparisons
for short keys, SIMD/word comparisons for long keys, and a hash strategy for
very wide objects. Unknown values are skipped with full structural validation.
Duplicate known keys overwrite previous values so the last occurrence wins.

### 8.2 Dynamic path

Dynamic `JSON.Value`, `JSON.Obj`, and `JSON.Arr` use a tagged tape/slot graph.
Small objects use linear lookup; wider objects build an open-addressing index.
Keys and untouched values remain UTF-8 source spans until materialized.

### 8.3 Strings

- SIMD scan for quote, backslash, and control bytes.
- Clean strings remain source spans.
- Escaped strings record a flag and are unescaped only when required.
- Getter materialization decodes to a JavaScript string once and caches it.
- Mutated strings are encoded directly into document or operation storage with
  the Node Buffer bridge.
- Strict UTF-8, escape, surrogate, and control-character validation is required.

### 8.4 Numbers and literals

- Parse JavaScript/TypeScript `number` directly to `f64`.
- Port the proven integer, Clinger, Eisel-Lemire, and fallback logic from
  `json-as`, adapted to UTF-8 pointers.
- Preserve negative zero and native overflow/underflow behavior.
- Reject non-JSON `NaN` and infinities in input.
- Parse booleans and null with bounded packed comparisons.

### 8.5 Safety

- All input reads are explicitly bounded before unchecked SIMD or word loads.
- Padding may be reserved after input to permit safe overreads in proven hot
  loops, but logical bounds are still enforced.
- Malformed input returns a recoverable error and byte offset.
- Recursion has a configurable hard limit or uses an explicit scratch stack.
- Unknown fields are validated, not blindly skipped.
- Strict and optimized paths must agree on every accepted and rejected input.

## 9. Typed JavaScript views

### 9.1 Objects

For classes, create parsed instances without invoking constructors and attach
the final decorated class prototype where compatible. Generated accessors read
and write fixed memory offsets through cached runtime views.

Benchmark two descriptor strategies:

1. Shared prototype accessors for maximum construction and access speed.
2. Shared own enumerable accessors installed with `Object.defineProperties` for
   closer `Object.keys`, spread, and native object behavior.

Choose the default using end-to-end benchmarks. A compatibility build option is
acceptable if the performance difference is material, but avoid a proliferation
of runtime modes.

Strings and nested objects are materialized lazily and cached. Setters write
fixed-size scalars directly and append variable-sized values to document storage
or a host overlay.

Classes requiring constructor-created private slots cannot be safely instantiated
as views. Emit a diagnostic or use a detached host-object path.

### 9.2 Real arrays

`JSON.parse<T[]>()` returns a real JavaScript array:

- Primitive elements are materialized.
- Struct elements become lightweight typed views.
- Nested array fields materialize lazily and cache the same real array instance.
- Once a JS array is exposed, it becomes authoritative because native mutations
  cannot be observed from Wasm without a Proxy.

`JSON.Array<T>` remains memory-backed and exposes explicit `at`, `set`, iteration,
and bulk/column access without creating a normal JS array.

### 9.3 Ordinary-object behavior

Target the following where they do not compromise the main design:

- field reads and assignments
- `instanceof` for decorated classes
- stable repeated property identity for strings, objects, and arrays
- enumerable schema fields
- `Object.keys` and spread in the chosen compatibility strategy
- class methods that depend only on normal schema fields

Exact property descriptors, constructor side effects, arbitrary reflection, and
private-slot behavior are not guaranteed.

## 10. Serialization architecture

### 10.1 Canonical ingress format

The serializer accepts the same flat format produced by the parser.

For an ordinary JavaScript value, generated JS lowering performs a schema-directed
walk and writes an ingress graph into scratch:

- scalars become typed-array stores
- strings are written directly with `Buffer.write`
- objects become fixed-layout records
- arrays become contiguous ingress arrays
- presence and null state are bitmaps

One Wasm call then serializes the complete graph to raw UTF-8 output.

### 10.2 Parsed views

An unchanged parsed view can be serialized directly from its persistent document.
Unmaterialized strings and composites can reuse source spans. Host overlays and
materialized JS arrays are lowered into scratch and referenced through a small
serialization overlay before the Wasm call.

### 10.3 Writer

- Output keys and static syntax are generated byte constants or data segments.
- Clean spans use `memory.copy`.
- Strings use SIMD escape classification and clean-run copying.
- Integers and floats use raw formatting kernels.
- Buffer growth follows an adaptive sizing policy derived from `json-as`, but
  capacity is normally reserved by the binding before the call.
- Successful stringify returns an output pointer and byte length in the result
  header; the binding performs one `Buffer.toString`.

### 10.4 JavaScript fallback backend

Generate a JavaScript serializer from the same schema IR as a benchmark-selected
fallback. Small plain objects with many short JS strings may not amortize
flattening and Wasm output conversion. The Wasm serializer remains mandatory;
the faster backend is selected by measured schema/payload classes rather than
ideology.

## 11. Decorators

Initial `json-ty` decorators should cover the practical `json-as` surface:

- `@json` / `@serializable`
- `@alias`
- `@omit`
- `@omitnull`
- `@omitif`
- `@optional`
- `@lazy`
- `@eager`
- raw JSON/custom codec markers
- class-level lazy/default/strict policies where useful

Decorator rules:

- Consume only symbols exported by `json-ty`.
- Preserve all unknown decorators in normal TypeScript output.
- Unknown decorators do not automatically become JSON semantics.
- A field modified by an unknown runtime decorator may be materialized into a
  host-managed property and read during stringify lowering.
- Supported `@omitif` expressions compiled into Wasm are restricted to a
  documented pure subset: schema field reads, literals, arithmetic, comparisons,
  and boolean logic without captured mutable state.
- Arbitrary custom JavaScript serializers/deserializers use a host slow path or
  an explicit codec with JS and raw-Wasm implementations.

## 12. Extracting the `json-as` core

This is a behavioral and algorithmic port, not a line-for-line copy of managed
interfaces. Preserve license/provenance and keep differential tests against the
source implementation where practical.

Port order:

1. UTF-8 scalar/SWAR/SIMD scanners.
2. Strict string validation, escape scanning, and unescaping.
3. Integer parsing.
4. Floating-point parsing and exact fallbacks.
5. Integer and ECMAScript-compatible `f64` formatting.
6. Raw output writer and adaptive sizing.
7. Generated typed-object fast paths.
8. Primitive, struct, and nested arrays.
9. Defaults, optional fields, aliases, nullability, and omission.
10. Arbitrary-order and unknown-field fallback.
11. Dynamic `Value`, `Obj`, and `Arr`.
12. Lazy spans, reuse, string classifications, and trace specializations.
13. Maps, sets, dates, raw values, enums, generics, and custom codecs.

Candidate raw kernel signatures look like:

```ts
parseF64(src: usize, end: usize, destination: usize): usize
scanString(src: usize, end: usize): u64
scanValueEnd(src: usize, end: usize): usize
parsePlayer(src: usize, end: usize, record: usize): usize
writeEscapedUtf8(src: usize, length: u32, writer: usize): void
```

No kernel returns or accepts an AssemblyScript standard-library value.

Implemented organization:

```text
assembly
├── deserialize/{scanner,null,boolean,number,string,array,struct,dynamic}.ts
├── serialize/{writer,boolean,number,string,array,struct,dynamic}.ts
├── layout/{document,record,array,dynamic}.ts
└── runtime.ts
```

The generator emits packed-key, fixed-offset record/array/union functions and
calls these `@inline` kernels. This keeps the json-as-style separation between
maintained type algorithms and transform-produced API-shape code without adding
generic dispatch or Wasm boundary crossings.

## 13. Correctness strategy

Correctness is a release gate, not a post-optimization cleanup.

### 13.1 Differential tests

- Compare typed results recursively against native `JSON.parse`.
- Compare serialized semantic values against native `JSON.stringify` for the
  supported contract.
- Reuse the `json-as` RFC matrix and JSONTestSuite corpus.
- Test every optimized feature in scalar, SWAR, and SIMD modes.
- Verify duplicate keys, unknown keys, missing keys, field order, pretty input,
  escapes, Unicode, edge numbers, and deep nesting.

### 13.2 Fuzzing

- Generate random valid schemas and matching JSON documents.
- Generate malformed mutations of valid documents.
- Differentially compare native, scalar, SWAR, and SIMD behavior.
- Exercise parse, full recursive read, mutation, stringify, and reparse.
- Include allocation reuse, memory growth, document release, and stale-view tests.
- Run a minimum fixed fuzz count in CI and longer scheduled fuzz campaigns.

### 13.3 Compatibility tests

- Classes, interfaces, inheritance, and recursive schemas
- real arrays and all normal mutations
- `Object.keys`, spread, and enumerable behavior
- class prototypes and methods
- known and unknown decorators
- Node strings, Buffers, and Uint8Arrays
- unpaired surrogates and non-ASCII payloads
- multiple simultaneously live parsed documents

## 14. Performance strategy

### 14.1 Measurement rules

- Benchmark changing payloads rather than relying on exact-source identity.
- Separate cold compilation/instantiation from steady-state execution.
- Report logical input/output bytes per second and operations per second.
- Report copy, Wasm kernel, commit, JS view/array hydration, string decoding,
  flattening, and output decoding separately.
- Prevent dead-code elimination and accidental lazy-string benchmarks.
- Verify benchmark results against native output before recording timings.
- Run on Node/V8 first, then add other engines after the Node design stabilizes.

### 14.2 Required comparisons

- native `JSON.parse` and `JSON.stringify`
- current `json-as` on equivalent payloads
- current `json-ty` experiments
- scalar, SWAR, and SIMD generated kernels
- string input versus Buffer input
- full read versus partial read
- parsed-view stringify versus ordinary-object stringify
- real arrays versus `JSON.Array<T>`
- fresh parse versus reusable document/destination

### 14.3 Performance gates

Before calling the rewrite production-ready:

- Resident typed parse kernels should reach parity with or exceed equivalent
  `json-as` kernels on representative payloads.
- Buffer-to-view parsing should beat native on the target schema workloads.
- String-to-view parsing should beat native after including `Buffer.write` on
  medium and large target workloads.
- Small-object regressions must be explicitly measured and either optimized or
  routed to a faster backend.
- Parsed-view stringify should reach `json-as`-class throughput when values are
  already in flat memory.
- Plain-object stringify must choose the faster generated backend based on data,
  not be forced through Wasm when flattening loses.
- No optimization may bypass correctness, validation, or lifetime safety.

Initial experiments show that Node UTF-8 copy is usually not the bottleneck,
resident SIMD scanning has substantial headroom over native parsing, and the
remaining challenge is converting that headroom into flat document materialization
and JavaScript-compatible result construction.

## 15. Implementation phases

Each phase ends with tests, fuzzing appropriate to its surface, benchmarks, and
an architecture review. Do not begin broad feature expansion on an unvalidated
memory format.

### Phase 0: preserve evidence and establish baselines

- Freeze or archive the existing benchmark outputs with environment metadata.
- Keep existing experiments and fuzzers runnable.
- Add comparable `json-as` and native benchmark commands.
- Define payload classes: tiny, small, medium, large, string-heavy, numeric,
  nested, array-of-records, and dynamic.
- Record Node, V8, AssemblyScript, and CPU details.

Exit: reproducible baseline suite with correctness checks.

### Phase 1: raw runtime and Node ABI

- Create imported memory and the custom synchronous Node binding.
- Implement view refresh after memory growth.
- Implement result header and recoverable capacity retry.
- Implement scratch bump allocation.
- Implement persistent document allocation/release.
- Implement raw UTF-8 input and output bridges.
- Add memory growth, concurrent-document, release, and stale-view tests.

Exit: raw byte round trip with no managed AS values or generic loader.

### Phase 2: minimal schema compiler

- Define and version the schema IR.
- Analyze decorated classes and direct typed call sites.
- Generate one AS module and Node binding.
- Transform typed parse/stringify calls.
- Implement cache hashing and deterministic generated output.
- Support one flat class with number, boolean, and string fields.

Exit: a generated `Player`-like schema builds incrementally and executes.

### Phase 3: high-performance flat parse

- Port UTF-8 string, structural, integer, and float kernels.
- Generate ordered and arbitrary-order object paths.
- Add presence/null bitmaps and default templates.
- Retain string source spans.
- Commit scratch documents into persistent memory.
- Generate typed getters and setters.
- Differential fuzz against native JSON.

Exit: flat typed objects are correct and competitive end-to-end.

### Phase 4: arrays and nested graphs

- Add primitive, string, struct, and nested arrays.
- Add nested objects and recursive schemas.
- Return real JS arrays in the default API.
- Add `JSON.Array<T>` as the zero-copy facade.
- Implement lazy/cached nested materialization.
- Add array mutation and stringify-overlay tests.

Exit: realistic nested payloads and array-of-records workloads work correctly.

### Phase 5: raw Wasm serialization

- Port raw UTF-8 writer and number formatting.
- Generate schema-specific serialization.
- Serialize unchanged parsed documents directly.
- Generate ordinary-JS-value lowering into the flat ingress format.
- Merge host overlays and materialized arrays.
- Add Node output decoding and capacity prediction.
- Generate and benchmark the JS serializer fallback.

Exit: both parsed views and ordinary typed JS objects stringify correctly, with
the faster backend selected from evidence.

### Phase 6: decorators and schema richness

- Implement aliases, omit, omit-null, omit-if, optional, lazy, and eager.
- Preserve unknown decorators.
- Add host-managed decorated-field fallback.
- Add inheritance, interfaces, tuples, enums, discriminated unions, and concrete
  generic instantiations.
- Add compile-time diagnostics for unsupported constructs.

Exit: the principal `json-as` decorator experience is available in TypeScript.

### Phase 7: dynamic JSON

- Implement raw tagged values.
- Add `JSON.Value`, `JSON.Obj`, and `JSON.Arr`.
- Add lazy key/value source spans.
- Add small-object linear lookup and wide-object hashing.
- Add plain object/array detachment helpers.
- Add `JSON.Raw` and boxed primitive compatibility.

Exit: unknown-shape JSON is supported without weakening typed fast paths.

### Phase 8: full `json-as` optimization parity

- Add reuse and steady-state specializations.
- Add escape classification caches.
- Add pretty-input specialization if still beneficial.
- Add exact-default-document specialization where useful.
- Port remaining collections, codecs, and numeric/string specializations.
- Tune code size, compile time, allocator behavior, and module initialization.

Exit: documented feature and optimization matrix against current `json-as`.

### Phase 9: browser and packaging hardening

- Add browser byte bindings using `TextEncoder.encodeInto` and `TextDecoder`.
- Add Wasm feature detection or a fallback artifact if required.
- Add bundler adapters using the shared compiler API.
- Finalize package exports, source maps, declarations, debug output, and artifact
  caching.
- Test Node ESM/CommonJS and major bundlers.

Exit: stable developer experience without compromising the Node fast path.

## 16. Maintainability requirements

- The schema IR is the single source of truth.
- Generated files are deterministic and inspectable.
- Raw memory layouts are versioned and documented.
- Every unsafe load/store has a local bounds invariant or safe-padding rule.
- Optimization tiers share correctness tests.
- Feature additions update the type matrix, decorator matrix, fuzz generators,
  and benchmarks together.
- Keep raw kernels small and composable; do not recreate the monolithic
  `json-as` transform.
- Avoid hidden global compiler state so watch mode and multi-project builds are
  deterministic.
- Performance changes include before/after results and correctness evidence.

## 17. Principal risks and mitigations

### JavaScript result construction erases the Wasm gain

Mitigation: keep typed fields memory-backed, materialize strings and nested
values lazily, separate real-array compatibility from `JSON.Array`, and measure
hydration independently.

### Plain-object stringify spends too much time flattening

Mitigation: generate both Wasm-ingress and direct-JS serializers from one IR and
select using benchmarks.

### Memory growth invalidates host views

Mitigation: JavaScript owns imported memory, reserves before calls, centralizes
growth, and refreshes all cached views exactly once.

### Stub runtime leaks memory

Mitigation: never use the stub heap for document data; implement explicit
scratch and persistent allocators with release.

### UTF-8 diverges on ill-formed JS strings

Mitigation: detect and route the rare case to a semantics-preserving fallback.

### Decorators conflict with memory-backed accessors

Mitigation: resolve known decorators by symbol, preserve unknown decorators, and
make affected fields host-managed when their runtime semantics cannot be safely
composed.

### Generated code becomes too large or slow to optimize

Mitigation: share raw kernels, chunk very wide generated functions, benchmark
ordered-tier duplication, cache Wasm artifacts, and compare `-O2` with `-O3`.

### Unsafe SIMD paths accept malformed input

Mitigation: scalar/SWAR/SIMD differential fuzzing, padding invariants, explicit
logical bounds, JSONTestSuite, and strict error equivalence.

## 18. Definition of done

The rewrite is complete when:

- Typed parse and stringify use generated schema-specialized Wasm.
- The Wasm side operates only on raw memory and numeric ABI values.
- Node bindings are custom, synchronous, Buffer-aware, and allocation-conscious.
- Multiple parsed documents remain valid simultaneously and can be released.
- Typed objects, real arrays, nested graphs, defaults, nullability, and supported
  decorators behave according to the documented contract.
- Dynamic JSON facades are available as opt-in APIs.
- The supported RFC behavior is differentially tested and fuzzed.
- Resident kernels meet the `json-as` parity target.
- End-to-end benchmarks identify and route workloads where native or generated
  JS remains faster.
- The compiler, generated code, ABI, layout, and performance methodology are
  documented well enough for future optimization without architectural drift.

## 19. Implementation outcome (2026-07-17)

The definition of done above is implemented. The repository now contains the
schema IR/compiler and typed-call transform, generated raw AssemblyScript,
stub-runtime Wasm artifact, custom Node and browser bindings, flat typed and
dynamic layouts, real and facade arrays (including top-level roots), decorator
handling, raw writer, allocator/lifetime safety, scalar/SWAR/SIMD correctness
paths, differential fuzzing, an RFC matrix, build caching, and benchmark routing.

The exact sibling `json-as` Vec3 SIMD artifact was used as the resident-kernel
parity check: json-ty measures roughly 18–21 M parse+release operations/s versus
17.14 M operations/s for that artifact on this machine. End-to-end Buffer parse,
retained stringify, and parse/stringify beat the corresponding native baseline
in the checked-in small typed workload. See `benchmark/results/raw-flat-baseline.md`
for the reproducible numbers and caveats.

The following Phase 8/9 extensions remain deliberately outside the completed
basic contract and are recorded in `FEATURE_MATRIX.md`: explicit Date/Map/Set
representation policies, typed binary/custom Wasm codecs, a packaged no-SIMD
artifact, and CommonJS adapters. They do not change the raw-memory architecture
and should only be added with an explicit JSON representation and benchmarks.

## 20. Type-kernel refactor outcome (2026-07-18)

The AssemblyScript backend is now a dedicated type-kernel library rather than a
monolithic generated implementation. Deserialization, serialization, flat
layouts, and dynamic JSON have explicit modules; generated source contains only
schema-specific packed dispatch and record/array/tuple/union control flow.

The ABI remains one Wasm call per normal typed or dynamic parse/stringify. The
representative artifact still imports only memory and the rare raw-pointer
number fallback, contains no managed AS values, passes SIMD and scalar
differential fuzzing, and remains within the established performance gates.
Compiler and Wasm contract tests make those properties regression failures.

## 21. json-as core port and flat-layout optimization outcome (2026-07-18)

The compatible hot kernels are now ported rather than wrapping managed
AssemblyScript values: four UTF-8 digit lanes use json-as's pair-multiply fold,
and exact i32/u32-valued TypeScript numbers use its digit-pair itoa width ladder
with direct UTF-8 stores. Short integer parsing deliberately remains scalar,
matching json-as's benchmark finding that a failed packed probe at the common
one-to-three-digit boundary costs more than it saves.

Generated homogeneous arrays no longer recursively validate/count and then
decode. They parse once into bounded high-end LIFO scratch and flatten the exact
slot count into the persistent arena; tuples allocate their known size directly.
This also corrected nested array references to their required eight-byte
`{offset,count}` stride. The Canada classic typed parse moved from roughly
135–165 MB/s before this pass to roughly 516–627 MB/s in repeated local runs,
while scalar/SIMD differential fuzz and the full API/compiler suites remained
green.

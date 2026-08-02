# Architecture

## Pipeline

The canonical build entry is the `json-ty/transform` ts-patch source
transformer. It receives the TypeScript 6 `Program`, generates application
artifacts synchronously before emit, and returns the ordinary per-file call
transformer. AssemblyScript compilation runs in a child process only on a
semantic-cache miss because TypeScript transformer hooks are synchronous.
Subsequent ts-patch transforms continue normally in configured order.
`json-tyc` calls the same generation and transformation primitives through an
async standalone orchestration path.

The TypeScript analyzer is the authority for type identity and reachability.
It discovers `json-ty` imports, decorated declarations, and typed calls, then
normalizes them into schema IR version 5. Source paths are excluded from the
semantic hash. AssemblyScript generation, host layouts, call rewriting, and
serialization policy all consume this IR.

For each project, generation produces one Wasm module. Shared raw kernels are
emitted once; records, array shapes, tuples, and union dispatch receive
schema-specialized functions. The build uses the stub runtime, imported memory,
the selected compile-time kernel tier, bulk memory, `-O3`, no assertions, and
no generated loader glue. SWAR is the default; naive is the RFC oracle and SIMD
is explicit. The compiler injects an integer tier constant and Binaryen removes
unselected bodies, so generated schema code has no tier import or runtime branch.
The artifact-compiler module owns generated paths, layout writes, compiler
flags, diagnostics, synchronous/asynchronous invocation, and optional Wasm
caching. It derives a content identity from the exact generated Assembly,
layouts, compiler arguments and version, and maintained runtime sources. Cache
entries are addressed by that identity, so callers select only a cache
directory and cannot accidentally reuse an artifact built from different
inputs. Project builds, tests, and benchmark scripts are adapters that state
their schemas and compilation intent.

The two backends share a canonical per-type plan, then dispatch through parallel
type-emitter registries under `compiler/src/emit/assembly` and
`compiler/src/host-artifact/emit`. Number, boolean, string, object, array/tuple, and union
policy therefore has one explicit extension point on each side instead of being
scattered through root-schema switches. The AssemblyScript emitters generate
fixed-offset parse/write expressions; the host emitters generate fixed-mask
accessors and specialized hot getters. Every setter delegates its complete
presence, null, lazy, overlay, serialization, dirty, and enumerable transition
to the shared view-state module. The enclosing host-artifact module owns the complete
generated JavaScript runtime, including view classes, schema registration,
compact ABI exports, and transformer bindings; build orchestration consumes the
single resulting artifact without knowing raw view-state policy.

Typed call sites are rewritten to hygienically named imports of compact
schema-specific host exports (`pN`/`sN`). The runtime object is imported only
when a file also contains a dynamic or otherwise indirect call. Those host
exports cache their matching Wasm function, so a normal typed parse or stringify
crosses the boundary once without a runtime name lookup.

Raw and generated object views share the document/view-state module. It owns
symbol identity, construction, root ownership and release, serialized/canonical
invalidation, overlays, enumerable compatibility, lazy materialization, and
field-write state transitions. The raw adapter retains specialized hot getters,
while the generated adapter retains emitted fixed-offset getters; both delegate
mutations to the same invariant owner.

Portable and browser bindings are thin adapters over one internal host-byte bridge.
The bridge owns memory-view refresh after growth, UTF-8 ingress and egress,
scratch-input residency, result-header access, root envelopes, and raw versus
JSON input modes. The portable adapter selects an available Buffer acceleration
without depending on it; the browser adapter explicitly injects
TextEncoder/TextDecoder. Generated runtimes load their sibling Wasm through
standard URLs, using fetch for network assets and the native host reader for
local file URLs.

## AssemblyScript kernel library

The maintained implementation lives under `assembly`, divided into
`deserialize/`, `serialize/`, `util/`, and `layout/`. Naive, SWAR, and SIMD
kernels use matching tier directories beneath their deserialize/serialize
roots. Each root has a `kernel.ts` selection module; it is the only module that
reads the compile-time tier constant. Stable grammar entry points delegate to
it and contain no tier branches of their own.
Null, boolean, number, string,
array, struct, and dynamic JSON each have a dedicated module. The bounded UTF-8
writer lives in `serialize/writer.ts`; tier-neutral scanner entry points live
in `deserialize/scanner.ts`. Root-level `parser.ts`, `writer.ts`, and `dynamic.ts`
are compatibility barrels only.

Generated AssemblyScript is deliberately thin. It emits one root parse/write
pair plus specialized record, array, tuple, and union functions for the API
shape. Those functions retain packed field-key comparisons, constant offsets,
ordered-object fast paths, and decorator policy, while calling the maintained
type kernels for primitive syntax and storage. Kernel entry functions are
`@inline`, and release WAT confirms they are folded into schema functions.
This provides one tunable implementation of each JSON type without replacing
schema specialization with a generic runtime dispatcher.

## ABI and memory

JavaScript creates and imports `WebAssembly.Memory`. Normal parse/stringify uses
one Wasm call. Additional results are returned in a 32-byte control header:

| byte | u32 field |
|---:|---|
| 0 | status |
| 4 | fault byte offset |
| 8 | root relative offset |
| 12 | document pointer |
| 16 | document byte length |
| 20 | output pointer |
| 24 | output byte length |
| 28 | required capacity |

Memory is split into control, operation scratch, and persistent regions.
Scratch is reset implicitly for every operation. Persistent blocks have an
8-byte header and are managed by an address-sorted free list. Allocation splits
large blocks; release coalesces adjacent blocks and rejects stale/double frees.
The allocation bit is stored in the high bit of the block size. A last-in,
first-out release with no intervening free blocks rewinds the bump pointer
directly, avoiding free-list insertion and splitting for short-lived documents.

Typed documents use only relative 32-bit offsets, so a memory grow does not
invalidate internal references. The host binding refreshes its optional Buffer,
typed arrays, and DataView-equivalent access after growth.

## Document layout v5

A document starts with a 16-byte header. Its root is a relative offset. A record
contains `ceil(fieldCount / 32)` override/presence words followed by the same
number of null words, then one aligned 8-byte slot per field. Records with
non-string deferred fields append an equally wide lazy bitmap. Missing defaulted
fields stay implicit: generated host getters and serializers read immutable
schema constants rather than copying a default graph into every document.
Primitive and recursively JSON-literal array/object initializers are retained.
Composite defaults are cloned into a per-document host overlay on first access,
so mutations never leak between parsed values. Exact compact default documents
allocate a zero-override record without parsing individual fields. Generated
code selects words and masks statically; the wide-schema regression compiles
and round-trips 150 fields, including lazy fields 63 and 127.

Primitive slots contain `f64`, `u32` booleans, or an 8-byte string reference.
String references retain source spans where possible. Length high bits identify
escaped data and arena-owned data. The first property read decodes and caches a
JavaScript string.

Array headers contain kind, length, relative data offset, and stride. Elements
are scalar values, string references, record offsets, array offsets, union
offset/tag pairs, or 16-byte tuple slots. Ordinary `T[]` values materialize to a
real JS Array lazily. `JSON.Array<T>` retains a facade and an indexed mutation
overlay.

Top-level arrays are represented in the IR as root-array schemas. The byte
bridge adds a private `{"value":...}` envelope so the same generated graph
parser and writer remain authoritative, then exposes only the real array or
facade and removes the envelope from output. Root arrays retain a hidden owner
for mutation/lifetime tracking and have a best-effort finalizer in addition to
explicit disposal.

Primitive roots use the same private envelope and generated field kernels.
The host unwraps string, number, boolean, or null values immediately and
releases the short-lived document view; serialization wraps the primitive,
uses the bounded Wasm writer, and removes only the private envelope bytes.

Dynamic values use a 16-byte tagged slot for null, boolean, number, string,
array, or object. Dynamic object entries store key/value references. Lookup is
linear for small objects and receives a cached host Map for wide objects.
Dynamic parsing builds this graph eagerly by default; `{ eager: false }` is the
explicit retained-span mode.

## Parsing

Generated object parsers validate the complete UTF-8 JSON grammar, skip unknown
values structurally, accept arbitrary property order, apply presence/null
tracking and defaults, and retain string spans. SIMD accelerates ASCII/string
classification while scalar logic owns boundary and escape validation.
The naive tier scans one byte/scalar at a time and is checked against all 318
pinned JSONTestSuite parsing fixtures. SWAR uses 16→8→scalar probing,
pair-multiply digit folds, and candidate-confirmation rules over UTF-8 bytes.
SIMD retains 16-byte classification where it wins. Tier selection is compile
time, and the differential/fuzz harness builds all three artifacts.

The low-level parser has two ownership contracts. The ordinary entry point
allocates an independently owned document and copies any source bytes retained
by string/lazy fields. `parseInto` instead reads a caller-owned resident byte
span and writes the document graph into a separate caller-owned bounded byte
span. Its document-relative source offsets deliberately wrap modulo 2^32, so
Wasm and host readers reach the external source without an intermediate copy.
The validating form retains the complete RFC grammar checks. The trusted form
is reserved for caller-validated canonical JSON/UTF-8 and uses SWAR or 16-byte
SIMD value-end scans for deferred composites. Releasing an
external document is a no-op; the caller owns both spans and their lifetimes.

Flat and nested records first try a canonical
ordered-property tier. It compares packed `"key":` bytes and parses values
without key scanning, dispatch, or whitespace calls. A second generated tier
accepts absent fields and arbitrary whitespace while retaining declaration
order. Reordered keys and unknown fields route to the general RFC parser. Any
key/separator mismatch rolls graph
allocation back, resets the record, and restarts at the fully validating
arbitrary-order tier; malformed values never bypass errors. All generated
homogeneous arrays parse in one pass into a bounded high-end scratch span, then
flatten their exact slots into the low persistent arena. Scratch reservations
nest in LIFO order, so primitive, record, union, and nested arrays avoid a full
validation/count pass without leaving maximum-sized holes in the document.
Tuples allocate their statically known slot count directly.
Numeric/boolean-only records also avoid copying source bytes into a persistent
document because no field can retain a source span.

Flat primitive schemas wider than 32 fields split the canonical tier into
monomorphic 32-field helpers. Each helper owns one bitmap word and returns one
of three results: key/separator mismatch (restart in the keyed tier), fatal
value failure (preserve the parser status), or the next cursor. This is real
generated control-flow chunking—not layout-only metadata—and keeps very wide
straight-line functions tractable for Binaryen.

Class lazy policy is resolved by the TypeScript analyzer after the reachable
schema graph is complete. `none` is eager unless a field has `@lazy` or
`JSON.Lazy<T>`; `all` defers every eligible field unless it has `@eager`; and
`auto` uses structural parse cost to keep cheap scalars and tiny scalar records
eager while deferring strings, collections, unions, and expensive records.
Unknown-decorator, raw, codec, and omitted fields remain eager because their
host policy must run without changing descriptor semantics.

Pure `@omitif` expressions are lowered by the analyzer into schema IR and
emitted directly in the Wasm writer. The compiled subset is literals,
non-nullable number/boolean field reads with compile-time primitive defaults,
unary `!`/`+`/`-`, arithmetic, comparisons, and boolean operators. More general
omit predicates remain a host-serialization concern; unknown decorator symbols
are never consumed by the transform.

During the initial parse, a deferred non-string slot contains the source-relative
start and byte length instead of its final value. The parser validates JSON
grammar but postpones schema conversion and arena allocation. Ordered minified
input uses a dedicated no-whitespace structural scanner; the arbitrary-order
fallback remains fully validating. On first JS access, one generated
`materialize<Type>Field` call parses the exact retained range into the document's
flat arena, overwrites the slot, and clears its bitmap bit. The document owns
extra reserved capacity for these later allocations. Repeated reads do not cross
the Wasm boundary. Untouched fields are copied raw by the generated serializer;
setters clear the bit and discard the range. Strings already have source-span
slots and use the existing first-read host decode cache.

The number lexer enforces JSON syntax. Common exact values use a Clinger path;
four fractional UTF-8 digits are folded at once with a byte-lane pair-multiply
SWAR kernel, and larger significands in the useful
exponent window use an Eisel–Lemire path. Structural skip/count scans validate
number grammar without redundantly converting the number.
Ambiguous long/wide decimals call the raw-pointer `parseNumberSlow` host import,
which delegates only that number to the engine's correctly rounded conversion.
No AssemblyScript string is created.

Host string input is scanned for lone UTF-16 surrogates. The rare case is
rewritten to JSON `\\uXXXX` escapes before UTF-8 encoding, preserving native JSON
semantics without changing the well-formed path. Raw byte-array input is
strictly UTF-8 validated. Because JavaScript strings are immutable, the host
binding keeps the most recent encoded JSON string resident in operation
scratch. Repeated parsing of that value skips surrogate classification and
UTF-8 encoding but still runs the complete Wasm parser and creates an
independently releasable document. Byte-array ingress, root-envelope
construction, and every scratch writer invalidate the resident input.

## Serialization

The writer emits UTF-8 bytes into scratch. Exact i32/u32-valued TypeScript
numbers use a width ladder and digit-pair lookup directly in UTF-8. Other
finite values use the xjb-as shortest binary64 formatter through a
tiny UTF-16 ASCII scratch buffer which is compacted to UTF-8; non-finite numbers
serialize as `null`.

An ordered minified parse whose reachable schema has no output-changing
decorators marks its retained UTF-8 source only as a canonical candidate. The
first serialization always runs the normal generated writer, then compares its
output against the retained source with SIMD/word/scalar bounded equality. An
exact match promotes the source to verified canonical; a mismatch permanently
clears the candidate. Later unchanged serializations are one bounded
`memory.copy`, including large flat numeric arrays. This preserves native
lexical behavior for inputs such as `1.0` and `"\\u0061"` without giving up the
round-trip fast path. Candidate/canonical bits share the source-length word and
are masked by every length reader. Every scalar setter, nested setter,
real-array overlay, and `JSON.Array` mutation clears both bits. Reordered,
pretty, defaulted, host-managed, raw, codec, omit, omit-null, and omit-if inputs
use the normal generated field writer.

The binary64 writer formats into output headroom and narrows ASCII UTF-16 lanes
with SIMD. Homogeneous number arrays reserve once and keep a local cursor while
emitting UTF-8.

The first serialization of an unchanged parsed view writes directly from its
document. Its canonical string is then cached on the view or shared document
state, making repeated `JSON.stringify` calls a constant-time lookup. Every
supported scalar, string, array-facade, and nested mutation invalidates the
cache. Mutated strings, real arrays, and nested overlays are lowered into the
canonical flat ingress layout before the Wasm writer runs. Plain values use
native JSON when schema-compatible and a schema-generated JavaScript writer
when decorators or host-managed fields require it. This avoids paying a Wasm
flattening cost where evidence says it loses.

## Views and safety

View accessors are emitted as real schema-specific JavaScript classes. Primitive
and string getters contain fixed bitmap masks and record offsets; composite
materialization remains on a shared cold path. Composite roots and retained nested views
share a document-state object so releasing the root invalidates every child.
Real arrays are authoritative after materialization; the serializer observes
their mutations. Class schemas may bind the generated view prototype above the
user class prototype, preserving methods and `instanceof` without invoking the
constructor.

The default fast view keeps memory fields on the prototype. The enumerable
compatibility mode installs present fields as own accessors and synchronizes
optional adds/removals.

## Wasm audit

The representative generated artifact imports only `env.memory` and
`env.parseNumberSlow`. `wasm-objdump` shows no `__new`, `__pin`, `__unpin`,
`__collect`, managed Array, or managed String runtime exports. Schema values are
never represented as AssemblyScript managed objects. A contract test also
wraps the cached typed and dynamic exports and asserts exactly one Wasm entry
per normal parse or stringify operation.

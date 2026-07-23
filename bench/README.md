# Overview benchmarks

`npm run bench:overview` builds a dedicated schema-specialized AssemblyScript
module with the stub runtime, runs the Node benchmark, and renders the overview
charts. Set `JSON_TY_BENCH_MS` to change the target measurement time per series
(the default is 250 ms).

The seven payload classes and display sizes match the comparison overview. The
medium and large fixtures are deterministic nested API/repository payloads. Each
serializer is checked for semantic equality before timing.

Serialization compares native JSON, the schema-generated JavaScript writer,
plain-object lowering through Wasm, an uncached retained-view write, and an
uncached opt-in dynamic `JSON.Obj` write. Cached lookup measurements are kept in
the raw results and performance gate, but excluded from the throughput chart
because they do not process the payload bytes again. The cache is owned by the
view/document and invalidated by every supported mutation. Deserialization
compares native JSON with typed and dynamic json-ty views over both strings and
Node `Buffer` input. Primitive payloads intentionally have no typed-object bars.
The typed-string overview series reuses the binding's one-entry resident UTF-8
encoding, matching the repeated immutable string used by the json-as benches.
`bench/profile-hotpaths.mjs` also reports alternating-string cache misses.

Outputs:

- `build/logs/overview.json`: raw measurements and run metadata
- `build/charts/overview-serialize.{svg,png}`
- `build/charts/overview-deserialize.{svg,png}`

`npm run bench:all` regenerates the full naive/SWAR/SIMD execution and
compile/size report, runs every ported kernel microbenchmark, renders all
benchmark-backed charts, and syncs the publishable SVGs to
`benchmark/charts/`.

The PNGs render at 3× density. The SVGs use the same palette, typography,
labels, metadata subtitle, and adaptive logarithmic scaling as json-as's
`overview-serialize` chart.

`scripts/check-overview-threshold.mjs` is the performance regression gate. By
default, both typed Node `Buffer` parsing and cached typed-view serialization
must reach at least 1.5× native throughput on a strict majority of applicable
corpora. Resident typed-string parsing has the same gate. Override the ratio
with `JSON_TY_MIN_NATIVE_RATIO` for experiments.

## Classic payloads

`npm run bench:classic` ports the complete benchmark matrix from
`json-as/assembly/__benches__/classic`: eager, lazy, and `JSON.Obj` parse and
minified serialization for Twitter, Canada, CITM, Poet, GitHub Events, GSOC,
Lottie, OTFCC, and FGO. The corpus-specific projections and the three Twitter
queries match the json-as sources. Native JSON is included as the Node baseline.

The canonical fixtures are 150+ MB in total and remain owned by json-as. The
runner discovers a sibling checkout at
`../json-as/assembly/__benches__/payloads`; set `JSON_TY_CLASSIC_PAYLOADS` when
it lives elsewhere. This keeps fixture bytes identical without vendoring a
second copy.

The eager series takes raw UTF-8 bytes, validates them, and constructs the
complete dynamic flat-memory graph in a single Wasm parsing pass. Validation
is mandatory; `validate: true` is both the explicit spelling and the default.
Lazy and `JSON.Obj` retain validated nested spans instead, while Canada and
Poet also have exact full typed schemas. Set
`JSON_TY_CLASSIC_INPUT=string` to include host UTF-16→UTF-8 ingress, or
`JSON_TY_CLASSIC_EAGER_BACKEND=host` to measure ordinary JavaScript-value
output through the host backend. A complete run owns
`build/logs/classic.json` and records every typed coverage gap and its reason;
partial projection schemas are deliberately not reported as typed results.
Filtered runs default to
`build/logs/classic-partial.json`, the smoke command writes
`build/logs/classic-smoke.json`, and chart generation rejects partial reports.
FGO and OTFCC are included in a full run and require large Wasm memories.
`npm run bench:classic:smoke` exercises representative typed, dynamic, pretty,
minified, and Twitter-query paths without those giant fixtures.

Useful controls:

- `JSON_TY_CLASSIC_FILTER=canada,poet`
- `JSON_TY_CLASSIC_VARIANTS=native,eager,lazy,obj`
- `JSON_TY_CLASSIC_FORMATS=pretty,min`
- `JSON_TY_CLASSIC_INPUT=buffer` (default) or `string`
- `JSON_TY_CLASSIC_EAGER_BACKEND=graph` (default) or `host`
- `JSON_TY_CLASSIC_MAX_BYTES=4000000`
- `JSON_TY_BENCH_MS=250`

`npm run bench:classic:v8` is the resident-engine counterpart. It builds the
SIMD artifact, runs all nine minified corpora in the d8/V8 shell with
`--no-liftoff`, applies the throughput gate, and renders
`classic-v8-{deserialize,serialize}.{svg,png}`. Node is used only to
orchestrate processes and write the report; both the native loop and the Wasm
loop execute entirely inside d8.

The runner uses an anti-elision setup: four same-shape payloads with
different string values are prepared outside timing, inputs rotate each
iteration, Wasm results flow through mutable linear-memory/global state, and
native results flow through a stateful JavaScript checksum. Fixtures above
8 MiB keep one input copy to avoid multiplying the resident set; parsing and
the observable sink still execute on every iteration.

The V8 report deliberately separates these semantics:

- `json-ty-into` / `json-ty-owned`: full typed document materialization
  (currently Canada and Poet);
- `json-ty-lazy-into`: caller-owned typed parsing with explicitly deferred
  fields, currently Canada’s coordinate payload;
- `json-ty-dynamic`: immediately validated, queryable `JSON.Obj`; the root
  index is built during parse and nested object/array graphs materialize once
  on access;
- `json-ty-projected`: an exact verified query over retained raw spans for
  CITM, Lottie, OTFCC, and FGO; its result is differential-tested against the
  JavaScript projection;
- `json-ty-raw`: complete JSON grammar validation over caller-asserted valid
  UTF-8, retained only as a scanner ceiling;
- `json-ty-serialize`: verified-canonical retained-source serialization.

Raw validation is not presented as a materialized or queryable replacement for
`JSON.parse`. Independent gates require validated, queryable `JSON.Obj` parsing
to beat JS on every corpus; require the fastest semantic typed/dynamic/projected
path to beat the fastest corresponding json-as mode; and require serialization
to beat both JS and json-as. Use `JSON_TY_V8_FLAGS`, `D8_BIN`, and
`JSON_TY_CLASSIC_V8_WASM` to test another engine configuration or artifact.

The Node classic report follows the same workload boundary. Rows with
`benchmark: null` measure deserialization only for every implementation.
Corpus projections are retained as explicit `benchmark: "projection"` rows,
and Twitter's three named queries remain separate query rows. This prevents a
json-ty parse-plus-query result from being compared with a built-in
`JSON.parse`-only result in the main payload chart.

Additional output:

- `build/logs/classic-v8.json`
- `build/charts/classic-v8-{deserialize,serialize}.{svg,png}`

## Lazy access matrix

`npm run bench:lazy` builds eager and auto-style lazy versions of the parity
small/medium/large schemas and measures matched native/eager/lazy parse-only,
one-field-access, and all-field-access cases. Results are written to
`build/logs/lazy.json`. This benchmark
keeps the host/Wasm boundary and disposal costs in the measurement because
first access is part of the public lazy contract; it is not a kernel-only scan
microbenchmark.

Outputs:

- `build/logs/classic.json`
- `build/charts/classic-payload-deserialize.{svg,png}`
- `build/charts/classic-payload-serialize.{svg,png}`

Additional full-report charts:

- `json-as-parity-{parse,serialize}.{svg,png}`: resident kernel, owning
  lifecycle, host call, and json-as throughput
- `lazy-access-pattern.{svg,png}`: parse-only, one-field, and all-field access
- `raw-{deserialize,serialize}.{svg,png}`: public and low-level raw API paths
- `tier-execution.{svg,png}`: geometric-mean throughput relative to the current
  SIMD reference
- `tier-{compile-time,wasm-size}.{svg,png}`: build cost by artifact and tier
- `rfc-coverage.{svg,png}`: all 318 JSONTestSuite fixtures by tier and expected
  outcome

Charts use a shared palette and layout conventions with json-ty series and
terminology. PNG output has an explicit white background and 3× density; SVGs
are copied to `benchmark/charts/` for the README and package.

Classic charts use the shared palette, typography, vertical value labels, and
metadata subtitle. Their axis stays linear unless the shared sparse-outlier
detector finds a genuinely huge (at least 4×) upper-tail discontinuity.

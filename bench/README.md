# Overview benchmarks

`npm run bench:overview` builds a dedicated schema-specialized AssemblyScript
module with the stub runtime, runs the Node benchmark, and renders the overview
charts. Set `JSON_TY_BENCH_MS` to change the target measurement time per series
(the default is 250 ms).

The seven payload classes and display sizes match json-as's overview suite. The
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

Canada and Poet currently run through exact, full typed schemas. Other eager
runs use the dynamic plain-object fallback, and their lazy/`JSON.Obj` runs use
the dynamic flat-memory view. `build/logs/classic.json` records every typed
coverage gap and its reason; partial projection schemas are deliberately not
reported as typed results. FGO and OTFCC are included in a full run and require
large Wasm memories. `npm run bench:classic:smoke` exercises representative
typed, dynamic, pretty, minified, and Twitter-query paths without those giant
fixtures.

Useful controls:

- `JSON_TY_CLASSIC_FILTER=canada,poet`
- `JSON_TY_CLASSIC_VARIANTS=native,eager,lazy,obj`
- `JSON_TY_CLASSIC_FORMATS=pretty,min`
- `JSON_TY_CLASSIC_INPUT=string` or `buffer`
- `JSON_TY_CLASSIC_MAX_BYTES=4000000`
- `JSON_TY_BENCH_MS=250`

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

Classic charts use the json-as palette, typography, vertical value labels, and
metadata subtitle. Their axis stays linear unless the shared sparse-outlier
detector finds a genuinely huge (at least 4×) upper-tail discontinuity.

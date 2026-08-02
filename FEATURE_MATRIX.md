# Feature and optimization matrix

This matrix records the implemented contract rather than implying full API
identity with the JavaScript standard library.

| Area | json-ty status | Notes |
|---|---|---|
| typed primitive roots and records | implemented | string, number, boolean, null, array, tuple, and record roots |
| nullable/optional/default fields | implemented | presence/null bitmaps and generated defaults |
| aliases, omit, omit-null, omit-if | implemented | pure omit-if expression required |
| on-demand typed lazy parsing | implemented | `none`/`auto`/`all`, field overrides, `JSON.Lazy<T>`, one first-access Wasm call, range passthrough |
| unknown decorators | implemented | preserved; affected fields become host-managed |
| inheritance/interfaces/classes | implemented | marker-free interfaces; multiple/generic interface bases; complete public class chain; constructor is not called; prototype can be bound |
| concrete generics | implemented | each concrete instantiation receives a schema |
| arrays of primitives/strings/records | implemented | real JS arrays by default |
| top-level typed arrays | implemented | generated root schema, hidden owner, finalization backstop |
| nested arrays and tuples | implemented | one-pass scratch/flatten arrays; fixed heterogeneous tuple positions |
| recursive records | implemented | generated depth guard |
| discriminated unions | implemented | shared literal discriminator required |
| `JSON.Array<T>` | implemented | zero-copy facade with indexed overlay |
| `JSON.Value`/`Obj`/`Arr` | implemented | eager tagged graph by default; retained spans require `eager: false` |
| `JSON.Raw` | implemented on host paths | validated raw insertion; typed `@raw` routes host-side |
| boxed primitives | implemented on host dynamic path | native-compatible unboxing |
| UTF-8 and Unicode validation | implemented | lone-surrogate compatibility bridge for JS strings |
| shortest correctly rounded numbers | implemented | packed UTF-8 fractions, Clinger, Eisel–Lemire, exact host fallback; direct integer output |
| SIMD classification | implemented | scalar boundary validation remains authoritative |
| trusted string ingress | implemented | JS strings use SIMD/SWAR structural scan; byte inputs retain strict UTF-8 validation |
| delta defaults and exact-default matcher | implemented | missing defaults remain implicit; exact compact defaults bypass field parsing |
| direct parsed-view writer | implemented | raw UTF-8, no managed AS values |
| verified canonical source-copy writer | implemented | first generated output must byte-match the ordered/minified candidate; lexical variants never bypass the writer |
| pure `@omitif` Wasm predicates | implemented | primitive defaulted field reads, literals, arithmetic, comparisons, boolean logic |
| wide canonical parser chunks | implemented | 32-field monomorphic helpers with mismatch/fatal/success protocol |
| direct typed host bindings | implemented | hygienic `pN`/`sN` imports; one normal Wasm call |
| ts-patch build integration | implemented | TypeScript 6 program-aware `before` transform; ordered plugin composition; synchronous cache-miss build |
| dedicated AS type kernels | implemented | null/boolean/number/string/array/struct/dynamic modules; schema calls inline |
| Wasm call boundary | implemented and tested | one Wasm entry per normal typed/dynamic parse or stringify |
| plain-object Wasm ingress | implemented | retained for workloads where benchmarking selects it |
| generated JS writer | implemented | native-compatible values use V8/JavaScriptCore/SpiderMonkey JSON; primitive alias/omit projections are emitted as straight JS; compiler-produced complex decorators use a lazily compiled CSP-safe plan |
| explicit document reuse/release | implemented | split/coalescing free list and stale-view protection |
| portable runtime binding | implemented and cross-runtime tested | one ESM/Wasm artifact; bytes, module, response, URL, request, blob, and local file loading across web APIs, Deno, Bun, and Node |
| Date | native host fallback | no dedicated Wasm policy yet |
| Map/Set policies | not implemented | require an explicit representation policy |
| typed-array/binary codecs | not implemented | no implicit JSON representation selected |
| arbitrary custom codecs in Wasm | not implemented | unsupported decorators fall through unchanged |
| untagged unions/index signatures/any | deliberately rejected | use dynamic JSON |
| reviver/replacer/pretty printing | out of scope | basic API only |
| naive/SWAR no-SIMD builds | default + correctness-tested | SWAR is default; naive is the RFC oracle; SIMD is explicit |
| CommonJS artifact | not packaged | current package is ESM-first |

The direct SIMD parity suite currently passes all 12 primitive-record,
small/medium/large, Canada, and Poet parse/serialize gates at a minimum 0.90x
ratio. Results are recorded in machine-readable form in
`build/logs/json-as-parity.json`.

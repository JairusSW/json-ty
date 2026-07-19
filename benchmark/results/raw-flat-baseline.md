# Raw flat-runtime bootstrap baseline

Recorded 2026-07-17 during Phase 1/2 of `PLAN.md`.

Environment:

- Node.js 24.18.0
- AssemblyScript 0.28.18
- x86-64 Linux
- generated four-field schema: two numbers, one string, one boolean
- 1,024 changing prebuilt JSON payloads
- full field read included

Command:

```sh
npm run bench:raw
```

Representative result:

| implementation | operations/second | logical throughput |
|---|---:|---:|
| native parse + read all | 3.8–3.9 million | 212–220 MB/s |
| raw parse + view + read all + explicit release | 0.97–1.04 million | 55–59 MB/s |
| raw parse + retained view + read all | 0.96–1.00 million | 54–56 MB/s |

This is a deliberately unoptimized bootstrap baseline, not a performance claim.
It proves the generated raw-memory path end to end, while showing that the first
implementation does not yet convert the SIMD scan ceiling into competitive
small-object performance. The next profiling pass must separate and optimize:

- schema parser execution
- persistent block allocation
- source copy into the persistent document
- generated view construction
- field reads and first string materialization
- explicit release overhead

Do not remove or weaken this benchmark when optimizing. Changing payloads and
the checksum must remain so exact-source caching and dead-code elimination do
not produce misleading results.

## First optimized parser/view/writer milestone

Same machine and payload family after replacing reflective view construction,
specializing direct persistent-document parsing, and adding raw UTF-8 output
with the xjb-as shortest-decimal kernel:

| implementation | operations/second | logical throughput |
|---|---:|---:|
| native parse + read all | 3.93 million | 221 MB/s |
| raw parse + view + read all + explicit release | 5.56 million | 313 MB/s |
| native stringify of retained objects | 5.62 million | 316 MB/s |
| raw stringify of retained flat views | 8.67 million | 488 MB/s |
| native parse + stringify | 2.03 million | 114 MB/s |
| raw parse + stringify + explicit release | 3.66 million | 206 MB/s |
| raw parse kernel + release (binding floor) | 8.20 million | 461 MB/s |

These are bootstrap microbenchmarks, not broad workload claims. They establish
that the raw ABI, custom Node binding, flat record, lazy string spans, generated
parser, and generated serializer can beat the corresponding native operations
for a small typed object without AssemblyScript managed user objects.

## Final safety-complete milestone

After adding shared nested-view lifetime state, allocator coalescing and
double-free rejection, portable browser byte bridges, mutation overlays, and
the optional own-enumerable object shape, the fast default measured:

| workload | native | json-ty `-O3` |
|---|---:|---:|
| string parse + read + release | 3.94 M ops/s | 4.06 M ops/s |
| Buffer parse + read + release | 2.16 M ops/s | 3.92 M ops/s |
| stringify retained value | 5.56 M ops/s | 6.56 M ops/s |
| string parse + stringify + release | 2.03 M ops/s | 2.47 M ops/s |
| kernel + release | — | 9.29 M ops/s |

The earlier peak excluded the final lifetime/compatibility checks and should
not be presented as the release number. The current result preserves all safety
gates and includes the canonical ordered-property tier with arbitrary-order
fallback.

A same-process `-O2` comparison produced about 3.23 M string parses, 3.47 M
Buffer parses, and 6.00 M retained serializations per second. `-O3` is therefore
the selected release configuration. Results vary between runs; checksums and
1,024 changing inputs remain mandatory.

For a resident-kernel comparison, the exact 19-byte Vec3 document used by the
sibling repository's checked-in SIMD artifact measured 18–21 M ops/s
(346–397 MB/s) in json-ty, including persistent allocation and release. Running
that json-as artifact with `bench/run-json-as-artifact.mjs` reported 17.14 M
ops/s (326 MB/s). This satisfies the representative resident-kernel parity gate
without comparing dissimilar payloads.

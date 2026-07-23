# Third-party notices

## json-as

The naive/SWAR/SIMD parsing and serialization kernels adapt algorithms from
`JairusSW/json-as`, pinned for this port at commit
`a179de04276fb5970e968fb2e42b8b4f1474913d`. json-as is MIT licensed. The full
historical inventory, snapshot hashes, porting rules, and license are under
[`assembly/JSON_AS_UPSTREAM.md`](./assembly/JSON_AS_UPSTREAM.md) and adjacent
`JSON_AS_*` files.

## JSONTestSuite

The RFC oracle contains the 318 parsing fixtures from `nst/JSONTestSuite` at
commit `1ef36fa01286573e846ac449e8683f8833c5b26a`. JSONTestSuite is MIT licensed;
fixture provenance and the license are under `src/raw/fixtures/`.

## xjb-as

Finite non-integer binary64 serialization uses the `xjb-as` shortest-decimal
formatter under its published package license.

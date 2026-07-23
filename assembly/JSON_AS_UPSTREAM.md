# json-as algorithm provenance

The canonical kernels in this directory were ported from
[`JairusSW/json-as`](https://github.com/JairusSW/json-as) at commit
`a179de04276fb5970e968fb2e42b8b4f1474913d`.

The original inventory phase copied 134 production files from upstream
`assembly/` into a temporary `assembly2/` incubator. The historical
`JSON_AS_SOURCE_MANIFEST.sha256` fingerprints that unmodified snapshot and
`JSON_AS_PORT_INVENTORY.tsv` records every disposition. After correctness and
performance cutover, the incubator was retired: adapted byte-native kernels
and their tests moved into this canonical tree; untouched, unsupported,
superseded, and unused copies were deleted.

Function signatures and memory ownership intentionally follow json-ty: bounded
raw UTF-8 pointers enter the parser, document-relative spans represent retained
data, and serialization writes to a caller-owned bounded byte region. The
algorithmic structure remains json-as-derived: packed operations, stride
hierarchy, candidate confirmation, fast-path ordering, fallback thresholds,
and branch shape are preserved except where RFC correctness or recorded
benchmarks require a deviation.

See `JSON_AS_LICENSE.txt` for the upstream MIT license. The active source paths
are `deserialize/{naive,swar,simd}`, `serialize/{naive,swar,simd}`, and `util`;
there is no second production kernel tree.

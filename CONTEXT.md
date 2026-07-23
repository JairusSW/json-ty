# json-ty

json-ty turns TypeScript JSON schemas into specialized WebAssembly artifacts
and host views while preserving JSON semantics over raw UTF-8 bytes.

## Language

**Schema**:
The complete JSON shape and policy discovered from a TypeScript declaration.
_Avoid_: Model, DTO

**Artifact**:
The coherent generated output for one schema set, including its executable
parser and the metadata needed by host code.
_Avoid_: Build output, bundle

**Document**:
One parsed JSON value together with the storage and lifetime that own it.
_Avoid_: Buffer, allocation

**View**:
A host-language value that exposes a Document according to its Schema without
requiring an ordinary-object copy.
_Avoid_: Proxy, wrapper

**Kernel tier**:
One complete performance strategy for the JSON kernels: naive, SWAR, or SIMD.
_Avoid_: Mode, backend

**Benchmark report**:
A provenance-bearing measurement set produced by one declared benchmark scope.
_Avoid_: Log, results file

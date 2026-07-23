# Changelog

All notable changes to json-ty will be documented here.

The project is currently distributed from GitHub at version `0.0.0`; behavior
may change between commits while the public API and generated artifact format
settle.

## 0.0.0 — Preview

- TypeScript Program/TypeChecker schema discovery and typed-call transformation
- ts-patch v4 integration for ordered TypeScript 6 transform composition
- synchronous cache-aware Wasm generation during normal `tspc` emit
- source-output-relative generated runtime imports for normal `src/` → `dist/` builds
- schema-specialized AssemblyScript generation and custom Node host bindings
- flat manually managed documents using raw UTF-8 and the stub runtime
- typed classes, interfaces, arrays, tuples, recursion, generics, and unions
- aliases, omission, defaults, lazy parsing, and unknown-decorator preservation
- dynamic `JSON.Value`, `JSON.Obj`, `JSON.Arr`, and memory-backed `JSON.Array`
- deterministic public `JSON.dispose(value)` document release
- SIMD/SWAR/scalar parser kernels and shortest binary64 serialization
- RFC, differential fuzz, generated-project, ABI, lifetime, and parity suites
- overview and classic benchmark charts

# Contributing to json-ty

Thank you for helping make typed JSON faster and safer.

`json-ty` sits at the boundary between the TypeScript compiler, generated
AssemblyScript, WebAssembly linear memory, and JavaScript host behavior. Small
changes can affect correctness, ABI stability, code size, or performance, so
focused pull requests with evidence are going to be easiest for me to review.

## Getting started

```bash
git clone https://github.com/JairusSW/json-ty.git
cd json-ty
npm install
npm run typecheck
npm test
```

For the full scalar and SIMD gate:

```bash
npm run test:all
```

## Repository map

```text
compiler/                 TypeScript analysis, schema IR, code generation
src/raw/assembly/         Allocation-free AssemblyScript kernels and layouts
src/raw/node-binding.js   Node memory, views, lowering, and Wasm ABI
src/raw/browser-binding.js
bench/                    Overview, classic, parity, and lazy benchmarks
scripts/                  Artifact builders and chart generation
```

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing layouts, ownership,
parser tiers, source-span flags, or the JS/Wasm boundary.

## Making a change

1. Create a fork of the repository.
2. Either push to `main` or create a separate branch.
3. Keep the change focused and preserve unrelated work.
4. Add a regression test before or with the implementation.
5. Run `npm run typecheck` and the relevant suites.
6. Include benchmark evidence for changes. Be sure to include deltas for before (main) vs after (your branch).

Useful commit prefixes include `feat:`, `fix:`, `perf:`, `docs:`, `test:`, and
`chore:`.

## Correctness contributions

Cover both accepted and rejected inputs where relevant. Parser and serializer
changes should consider:

- malformed and truncated JSON;
- UTF-8, escapes, surrogate pairs, and lone surrogates;
- negative zero, exponent limits, rounding, overflow, and underflow;
- reordered, unknown, missing, and duplicate keys;
- defaults, nullability, decorators, lazy fields, and mutation;
- arrays, tuples, recursive graphs, and discriminated unions;
- memory growth, release, reuse, and stale views;
- SIMD and scalar builds.

Run:

```bash
npm run test:raw
npm run test:compiler
npm run test:fuzz:raw
npm run test:fuzz:raw:scalar
```

## Performance contributions

Performance changes must retain semantic parity. Include:

- the exact command and payload;
- before/after throughput or latency;
- Node version, architecture, and Wasm feature mode;
- code-size impact where generated Wasm changes;
- an explanation of what moved off or onto the hot path.

Relevant suites:

```bash
npm run bench:overview
npm run bench:parity
npm run bench:lazy
npm run bench:classic:smoke
```

Avoid optimizing only a synthetic in-Wasm loop while making the production
Node boundary slower. Kernel and end-to-end results serve different purposes;
report both when the boundary is affected.

## Code style

- Use strict TypeScript and strong schema IR types.
- Keep maintained type algorithms in their dedicated kernel/emitter modules.
- Generated AssemblyScript must not use managed strings, arrays, or classes.
- Keep normal parse/stringify to one Wasm call.
- Use comments to explain invariants and non-obvious bounds, not syntax.
- Format only files in your change with `npx prettier --write <files...>`.

## Pull requests

Describe the problem, the chosen design, verification performed, compatibility
impact, and performance impact. Link related issues and include generated-code
snippets only when they clarify the change.

By contributing, you agree that your work is licensed under the MIT License.

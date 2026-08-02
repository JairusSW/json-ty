# Raw AssemblyScript kernel library

This directory is the maintained Wasm implementation. Generated application
modules contain schemas, packed key constants, and specialized control flow;
they do not contain independent implementations of JSON primitives.

```text
assembly/
├── deserialize/
│   ├── naive/       scalar RFC oracle kernels
│   ├── swar/        byte-lane kernels and document adapters
│   ├── simd/        16-byte UTF-8 string and structural scanners
│   ├── kernel.ts    compile-time tier selection
│   ├── scanner.ts   tier-neutral UTF-8/JSON grammar entry points
│   ├── digits.ts    packed UTF-8 digit folding
│   ├── null.ts      null literal
│   ├── boolean.ts   boolean literal and flat slot store
│   ├── number.ts    f64 entry point
│   ├── string.ts    validated source-span string reference
│   ├── array.ts     array validation/count and flat header setup
│   ├── struct.ts    object/document boundaries
│   └── dynamic.ts   tagged JSON.Value graph parser
├── serialize/
│   ├── naive/       scalar retained UTF-8 string writer
│   ├── swar/        bounded raw UTF-8 string writer
│   ├── simd/        vectorized retained UTF-8 string writers
│   ├── kernel.ts    compile-time tier selection
│   ├── writer.ts    bounded raw UTF-8 writer and shortest f64 formatting
│   ├── integer.ts   direct UTF-8 digit-pair integer writer
│   ├── null.ts      null writer
│   ├── boolean.ts   boolean writer
│   ├── number.ts    f64 writer entry point
│   ├── string.ts    quoted retained-span writer
│   ├── array.ts     array punctuation
│   ├── struct.ts    object punctuation and null writer
│   └── dynamic.ts   tagged JSON.Value graph writer
├── layout/
│   ├── document.ts  16-byte document header
│   ├── record.ts    presence/null bitmaps and 8-byte slots
│   ├── array.ts     16-byte array header and element kind tags
│   └── dynamic.ts   dynamic slot and entry tags/sizes
├── util/             shared byte-lane masks and digit folds
├── __tests__/        canonical microtests (excluded from npm package)
├── wasm/             earlier parser prototypes (excluded from npm package)
├── runtime.ts       scratch, result header, persistent allocator
└── eisel-lemire.ts exact numeric conversion kernel
```

`parser.ts`, `writer.ts`, and `dynamic.ts` are compatibility barrels for older
generated artifacts. New code imports the type modules directly.

## Generated/core boundary

Codegen owns facts that vary with the TypeScript API shape:

- one exported `parse<Type>` and `serialize<Type>` pair per root schema;
- packed field-name comparisons and canonical-order fast paths;
- fixed field offsets, presence/null masks, aliases, defaults, and omission;
- specialized record, array, tuple, and discriminated-union functions;
- direct calls to the type kernels above.

The core owns JSON grammar, UTF-8 validation, scalar storage, container syntax,
packed digit conversion/formatting, dynamic JSON, allocation, and flat layout
rules. Generated homogeneous arrays use the graph arena's high end as temporary
LIFO slots and flatten exact contiguous arrays into the persistent low end.
Type entry functions are marked `@inline`; release WAT identifies them as
inlined inside generated schema functions.

## ABI rules

- Normal parse and stringify cross the JS/Wasm boundary exactly once.
- `parse<Type>Into` and `parse<Type>IntoTrusted` read caller-owned raw UTF-8
  bytes and write the relative-offset document graph into a distinct,
  caller-owned bounded byte span.
- Strict parse-into validates JSON and UTF-8. Trusted parse-into assumes a
  previously validated canonical input and may use boundary-only SIMD scans.
- Caller-owned input and output must remain resident for the document lifetime;
  releasing an externally backed document is a validated no-op.
- The only release imports are `env.memory` and the rare
  `env.parseNumberSlow(pointer,length)` correctly-rounded fallback.
- No kernel accepts or returns an AssemblyScript managed value.
- No schema value uses `new`, `string`, `Array<T>`, `Map`, `Set`, or GC.
- Internal references are relative `u32` offsets, so memory growth is safe.

The codegen and Wasm contract tests enforce these rules.

## Kernel tiers

The artifact compiler injects `JSON_TY_KERNEL_TIER` as a compile-time integer:
naive `0`, SWAR `1`, SIMD `2`. Generated schema source is identical across
tiers. Only `deserialize/kernel.ts` and `serialize/kernel.ts` read that
constant; their inline selectors leave optimized Wasm with only the selected
bodies. SWAR is the
default. `npm run test:rfc-oracle` checks all tiers against the pinned RFC
corpus; `npm run bench:tiers` records correctness, compile time, size, raw,
Overview, Classic, lazy, and parity measurements in one report.

The SIMD tier includes dedicated 16-byte UTF-8 string, structural/value-end,
and retained-string serialization kernels. Strict non-ASCII strings use a
simdjson-derived lookup4 validator while ASCII and trusted strings retain the
lower-overhead classifier. The value-end scanner switches to block backslash
parity only for long escape runs. Escaped-string serialization keeps the SIMD
sparse-escape path and routes dense escape blocks to the faster SWAR loop.
Their tests cover unaligned starts, bounded tails, malformed UTF-8, escapes,
and exact-capacity output against the SWAR implementations. The
`bench:swar-port:*:simd` head-to-heads record the selection evidence directly.

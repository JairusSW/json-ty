# Raw AssemblyScript kernel library

This directory is the maintained Wasm implementation. Generated application
modules contain schemas, packed key constants, and specialized control flow;
they do not contain independent implementations of JSON primitives.

```text
assembly/
├── deserialize/
│   ├── scanner.ts   UTF-8, JSON grammar, SIMD/SWAR, number lexer
│   ├── digits.ts    packed UTF-8 digit folding
│   ├── null.ts      null literal
│   ├── boolean.ts   boolean literal and flat slot store
│   ├── number.ts    f64 entry point
│   ├── string.ts    validated source-span string reference
│   ├── array.ts     array validation/count and flat header setup
│   ├── struct.ts    object/document boundaries
│   └── dynamic.ts   tagged JSON.Value graph parser
├── serialize/
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
- The only release imports are `env.memory` and the rare
  `env.parseNumberSlow(pointer,length)` correctly-rounded fallback.
- No kernel accepts or returns an AssemblyScript managed value.
- No schema value uses `new`, `string`, `Array<T>`, `Map`, `Set`, or GC.
- Internal references are relative `u32` offsets, so memory growth is safe.

The codegen and Wasm contract tests enforce these rules.

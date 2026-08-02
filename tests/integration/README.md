# Integration tests

`npm run test:integration` compiles each behavioral spec as an isolated
json-ty application and runtime before executing it. The runner verifies the
complete 46-file behavioral inventory: 37 portable TypeScript suites execute
directly, while nine AssemblyScript memory contracts are covered by json-ty's
native kernel and raw-runtime tests.

The direct suites cover arrays, arbitrary values, booleans, boxes, containers,
custom codecs, dates, decorators, dynamic values, enums, fast paths, GC churn,
generics, inheritance, integers, lazy fields, maps, namespaces, nullability,
object indexing, overrides, parse reuse, malformed-input safety, raw values,
resolution, fuzz and round-trip matrices, sets, structs, tiny payloads, types,
and whitespace.

AssemblyScript-specific source contracts are retained under
`assemblyscript-contracts/` and map to these native tests:

| Contract | Native coverage |
| --- | --- |
| integer conversion | `npm run test:swar-port:integer` |
| floating-point conversion | `npm run test:swar-port:float` |
| lazy slot encoding | `npm run test:raw` |
| parse-into memory ranges | `npm run test:raw` and `npm run test:compiler` |
| fixed arrays | direct array suites and `npm run test:swar-port:arrays` |
| strings | `npm run test:swar-port:string` and `npm run test:raw` |
| SWAR integer primitives | `npm run test:swar-port:integer` |
| SWAR scanning primitives | `npm run test:swar-port:primitives` and `npm run test:swar-port:scanner` |
| typed arrays | host-codec cases in `npm run test:raw` and compiler schema tests |

The 318 RFC fixtures run independently under naive, SWAR, and SIMD through
`npm run test:rfc-oracle`.


# Third-party notices

## JSONTestSuite

The RFC oracle contains the 318 parsing fixtures from `nst/JSONTestSuite` at
commit `1ef36fa01286573e846ac449e8683f8833c5b26a`. JSONTestSuite is MIT licensed;
fixture provenance and the license are under `src/raw/fixtures/`.

## xjb-as

Finite non-integer binary64 serialization uses the `xjb-as` shortest-decimal
formatter under its published package license.

## simdjson

The SIMD lookup4 UTF-8 classifier, backslash-run parity scanner, and packed
eight-digit decimal strategy are adapted for AssemblyScript/WebAssembly from
simdjson commit `8c06c443301c30301be69268772d5f76d19fc17f`. simdjson is
Apache License 2.0 software. json-ty's versions are substantially modified for
16-byte Wasm SIMD lanes, bounded inputs, schema-specialized parsing, and
ECMAScript number semantics. The upstream license is included at
`licenses/simdjson-LICENSE`.

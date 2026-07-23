# RFC oracle fixtures

`json-testsuite-parsing.json.gz.base64` contains all 318 byte-exact files from
`nst/JSONTestSuite/test_parsing` at commit
`1ef36fa01286573e846ac449e8683f8833c5b26a`. The decoded gzip payload is JSON:

```text
{ source, commit, cases: [[filename, base64Bytes], ...] }
```

The textual compressed form preserves malformed UTF-8, UTF-16 inputs, NULs,
and the 100,000/250,000-byte nesting fixtures while keeping the repository
fixture compact. Classification follows the upstream filename contract:
`y_` must be accepted, `n_` must be rejected, and `i_` is
implementation-defined. See `JSONTestSuite.LICENSE` for the upstream MIT
license.

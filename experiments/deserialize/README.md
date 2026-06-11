# Deserialization bench (json-as payloads)

Payloads ported from json-as (`bench/*.bench.ts`): `abc`, `uuidv4`, `token`,
`small`, `medium`, `large` (a github repo response). `abc`/`uuidv4` are bare
strings wrapped as `{"v": …}` so the object engine applies. A schema is
auto-derived from each payload (`autoSchema`) so we don't hand-write large's ~80
fields.

```bash
node experiments/deserialize/bench.mjs   # -> build/logs/deserialize.json
node experiments/deserialize/chart.mjs   # -> deserialize.png
```

## Results (Node, MB/s)

![deserialize](./deserialize.png)

| payload | bytes | native | json-ty: read ALL | json-ty: read 3 |
|---------|------:|-------:|------------------:|----------------:|
| abc     | 60    | 502    | 649 (1.29×)       | 595 (1.18×)     |
| uuidv4  | 44    | 362    | 395 (1.09×)       | 377 (1.04×)     |
| token   | 49    | 283    | 284 (1.00×)       | 285 (1.01×)     |
| small   | 44    | 192    | 205 (1.07×)       | 198 (1.03×)     |
| medium  | 1070  | 415    | 328 (0.79×)       | **846 (2.04×)** |
| large   | 5251  | 852    | 499 (0.59×)       | **1032 (1.21×)**|

## Reading the chart (honestly)

- **`native` is flat** — `JSON.parse` always materializes the whole document.
- **`read ALL` is json-ty's worst case.** Forcing materialization of every field
  (large is ~80 mostly-URL strings) means lazy-parse + N string slices loses to
  native's single C++ pass on big docs (0.59× at 5 KB). Small docs still tie/win
  (parse overhead is tiny relative to per-call cost).
- **`read 3` is the design target** and where it pays off: medium **2.04×**,
  large **1.21×** — you skip the dozens of fields native eagerly parses.

The crossover *is* the thesis: native's cost is fixed by the document; json-ty's
scales with what you read. Full deserialize of a large string-heavy object is the
one case to reach for `@eager`/native; everything partial favors json-ty.

A real per-field-access cost worth noting: each getter currently builds a small
`{tag,off,len,ptr}` object in `decodeSlot` + a memo `Map` — measurable on the
read-ALL path (~80 allocs). Decoding into primitives (no object) is the obvious
next optimization for the full-read case.

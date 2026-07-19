# Correctness fuzzer

Generates random schemas + conforming JSON (shape-first, so object keys and array
element shapes are uniform — what a schema parser requires), then diffs **both**
json-ty engines — lazy and eager, full recursive read — against native
`JSON.parse`. Deterministic per seed (mulberry32).

```bash
node experiments/fuzz/fuzz.mjs [seed] [iters]   # default 12345 5000
bash experiments/fuzz/run.sh                     # sweep several seeds
```

Coverage: nested objects, struct arrays, num/str arrays, booleans; strings full
of the nasty bytes (`"` `\` `\n` `\t` `\r` `/`, latin-1, CJK, emoji → forces
`\uXXXX`/escape sequences); ints, big ints, 3-dp floats, scientific notation,
and specials (`0`, `-0`, `1`, `0.5`, …).

## What it caught

- **Eager didn't unescape strings.** It sliced the raw span, so `""`,
  `"a\rB"`, `\n`, `\\` came back literally (3521/5000 fail). Fixed in the eager
  engine: `skipString` flags a backslash, `storeField` sets the span length's
  high bit, and the reader `JSON.parse('"'+raw+'"')`-unescapes on read (the same
  trick the lazy engine's `STRESC` path uses). The flag costs nothing when a
  string is clean (the common case stays a pure slice).
- Needed a `resetSchemas()` export on both engines — the fixed-size schema
  registry (256/512 slots) overflows when a fuzzer registers thousands; reset
  reuses the slots each iteration.

## Result

```
24,000 cases across 6 seeds — lazy 24000/24000 ok, eager 24000/24000 ok
```

## Known, out of scope (by design)

- **`null`** isn't fuzzed: auto-schema infers a field's type from one sample, so
  nullability can't be represented here, and the eager engine stores `null` as
  zero bytes (reads `""` for a string, `0` for a number). Declared schemas handle
  null; this harness targets non-null value/structure/escape/number correctness.
- **Empty arrays** aren't generated (every array ≥1): auto-schema infers element
  type from element 0, so an empty array can't be typed — again a harness limit,
  not an engine one.

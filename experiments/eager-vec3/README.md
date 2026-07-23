# Eager primitive parse (Vec3)

Design rule: **non-string primitives are always eager.** A lazy span + JS-side
`parseFloat` for a number you'll almost certainly read is pure overhead — so AS
parses numbers/bools/null during the scan and hands the actual value back; only
strings stay lazy spans (string materialization is the 1.7 GB/s wall).

- `assembly/experiments/eager-vec3/eager.ts` — schema-directed scan that parses `x`/`y`/`z` to f64
  (Clinger fast-path `parseF64`, exact when mantissa ≤ 2⁵³ and |exp| ≤ 22) into a
  3-slot `f64` array. NaN = absent.
- `vec3.mjs` — `Buffer.write` the JSON into WASM, `parseVec3`, read the three
  doubles directly from a `Float64Array` (no decode, no `parseFloat`).

```bash
npx asc assembly/experiments/eager-vec3/eager.ts \
  --outFile experiments/eager-vec3/build/eager.wasm \
  -O3 --noAssert --bindings raw --runtime stub --exportRuntime
node experiments/eager-vec3/vec3.mjs
```

## Result

Exact vs native incl. `-0.0001`, `123456.789`, `1e-7`. Throughput:

```
read all 3   native 5.45M ops/s   |   eager 13.9M ops/s   =>  2.56× native
```

See `../parse-bench.mjs` + `../parse-bench.png` for the consolidated comparison:

| approach   | read 1 of 3 | read all 3 |
|------------|------------:|-----------:|
| native     | 5.45M       | 5.37M      |
| lazy-slot  | 5.67M       | 2.69M      |
| token      | 5.15M       | 2.59M      |
| **eager**  | **12.11M**  | **11.52M** |

Eager beats native ~2.2× on both access patterns and ~4× the lazy approaches on
read-all. The lazy span only paid off on read-1 *and* lost read-all; for
primitives, eager is strictly better. Reserve laziness for **strings** (and
nested objects/arrays), where deferring the expensive materialization is the win.

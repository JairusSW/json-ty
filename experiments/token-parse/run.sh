#!/bin/bash
# Build the SIMD tokenizer (stub runtime + simd) and run the Vec3 demo + bench.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

npx asc assembly/experiments/token-parse/tokenizer.ts \
  --outFile experiments/token-parse/build/tokenizer.wasm \
  --optimizeLevel 3 --shrinkLevel 0 --noAssert \
  --bindings raw --runtime stub --exportRuntime --enable simd

node experiments/token-parse/vec3.mjs

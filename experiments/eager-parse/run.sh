#!/bin/bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$ROOT_DIR"
npx asc assembly/experiments/eager-parse/eager.ts \
  --outFile experiments/eager-parse/build/eager.wasm \
  --optimizeLevel 3 --shrinkLevel 0 --noAssert \
  --bindings raw --runtime stub --exportRuntime --enable simd --enable bulk-memory
node experiments/eager-parse/bench.mjs
node experiments/eager-parse/chart.mjs

#!/bin/bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
npx asc assembly/experiments/payload-scaling/tokenizer.ts \
  --outFile experiments/payload-scaling/build/tokenizer.wasm \
  --optimizeLevel 3 --shrinkLevel 0 --noAssert \
  --bindings raw --runtime stub --exportRuntime --enable simd
node experiments/payload-scaling/scaling.mjs
node experiments/payload-scaling/chart.mjs

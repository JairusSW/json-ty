#!/bin/bash
# Build the AS bridge (stub runtime + SIMD) and run the throughput bench + chart.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

npx asc experiments/string-bridge/assembly/bridge.ts \
  --outFile experiments/string-bridge/build/bridge.wasm \
  --optimizeLevel 3 --shrinkLevel 0 --noAssert \
  --bindings raw --runtime stub --exportRuntime \
  --enable simd --enable bulk-memory

node experiments/string-bridge/bench.mjs
node experiments/string-bridge/chart.mjs

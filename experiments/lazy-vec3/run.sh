#!/bin/bash
# Build the Vec3 lazy-parse MVP (stub runtime) and run the demo + bench.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

npx asc assembly/experiments/lazy-vec3/vec3.ts \
  --outFile experiments/lazy-vec3/build/vec3.wasm \
  --optimizeLevel 3 --shrinkLevel 0 --noAssert \
  --bindings raw --runtime stub --exportRuntime

node experiments/lazy-vec3/vec3.mjs

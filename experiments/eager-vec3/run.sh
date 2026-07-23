#!/bin/bash
# Build the eager Vec3 parser (stub runtime) and run the demo + bench.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

npx asc assembly/experiments/eager-vec3/eager.ts \
  --outFile experiments/eager-vec3/build/eager.wasm \
  --optimizeLevel 3 --shrinkLevel 0 --noAssert \
  --bindings raw --runtime stub --exportRuntime

node experiments/eager-vec3/vec3.mjs

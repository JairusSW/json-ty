#!/bin/bash
# Build and run the Node-first json-ty overview benchmarks. The generated
# AssemblyScript module uses the stub runtime and communicates in raw UTF-8.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p ./build/logs
npm run build:compiler
node ./scripts/build-overview-runtime.mjs
node ./bench/overview.bench.mjs

echo
echo "Finished benchmarks"

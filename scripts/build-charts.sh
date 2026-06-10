#!/bin/bash
# Render benchmark result JSON (./build/logs/*.json) into SVG charts.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ./build/logs/serialize.json ]]; then
  echo "❌ No results found. Run ./scripts/run-bench.sh first."; exit 1
fi

bun ./bench/lib/chart.ts ./build/logs/serialize.json -o ./benchmark/results

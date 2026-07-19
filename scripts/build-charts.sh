#!/bin/bash
# Render the overview result JSON into json-as-style SVG and 3x PNG charts.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ./build/logs/overview.json ]]; then
  echo "❌ No results found. Run ./scripts/run-bench.sh first."; exit 1
fi

node ./scripts/lib/chart-outliers.test.mjs
node ./scripts/build-overview-deserialize.mjs
node ./scripts/build-overview-serialize.mjs
node ./scripts/check-overview-threshold.mjs

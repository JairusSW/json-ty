#!/bin/bash
# Render all benchmark reports into SVG and 3x PNG charts.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET="${1:-publish}"
if [[ "$TARGET" == "overview" ]]; then
  node ./scripts/lib/chart-outliers.test.mjs
  node ./scripts/build-overview-deserialize.mjs
  node ./scripts/build-overview-serialize.mjs
  node ./scripts/check-overview-threshold.mjs
  exit 0
fi
if [[ "$TARGET" != "publish" ]]; then
  echo "Unknown chart target: $TARGET" >&2
  exit 1
fi

node ./scripts/validate-benchmark-publication.mjs
if [[ ! -f ./build/logs/overview.json ]]; then
  echo "❌ No results found. Run ./scripts/run-bench.sh first."; exit 1
fi

node ./scripts/lib/chart-outliers.test.mjs
node ./scripts/build-overview-deserialize.mjs
node ./scripts/build-overview-serialize.mjs
node ./scripts/build-classic-charts.mjs
node ./scripts/build-report-charts.mjs
node ./scripts/lib/chart-layout.test.mjs
if [[ "${JSON_TY_SYNC_CHARTS:-1}" == "1" ]]; then
  node ./scripts/sync-benchmark-charts.mjs
fi
node ./scripts/check-overview-threshold.mjs
node ./scripts/validate-benchmark-publication.mjs --charts

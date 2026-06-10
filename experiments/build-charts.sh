#!/bin/bash
# Render every experiment chart with chart.js (ported from json-as).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
node experiments/simd-string/chart.mjs
node experiments/parse-chart.mjs
node experiments/payload-scaling/chart.mjs
node experiments/string-bridge/chart.mjs

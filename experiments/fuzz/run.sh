#!/bin/bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$ROOT_DIR"
for s in 1 2 99 777 31337 424242 12345; do
  node experiments/fuzz/fuzz.mjs "$s" 4000 | grep -E "lazy:|eager:" | tr '\n' ' '; echo "(seed $s)"
done

#!/bin/bash
# Build the bench under the json-ty transform and run it on V8 (d8).
#
# The transform injects `import ... from "./index.js"` / `"./exports.js"` into
# every file with an @json class, relative to the emitted file. We compile the
# bench flat into ./build and copy the shipped src runtime alongside it so those
# specifiers resolve. Type errors for those (intentionally unresolved at
# compile) imports are ignored; tsc still emits the JS.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

resolve_d8_bin() {
  if [[ -n "${D8_BIN:-}" ]]; then printf '%s\n' "$D8_BIN"; return 0; fi
  command -v v8 >/dev/null 2>&1 && { printf 'v8\n'; return 0; }
  command -v d8 >/dev/null 2>&1 && { printf 'd8\n'; return 0; }
  return 1
}
if ! D8_BIN="$(resolve_d8_bin)"; then
  echo "❌ Neither v8 nor d8 found in PATH (install via jsvu)"; exit 1
fi

rm -rf ./build
mkdir -p ./build/logs

# Compile bench + transform. Ignore the expected "cannot find ./index.js" type
# errors — emit still happens and the specifiers are preserved.
npx tsc -p ./bench/tsconfig.json > ./build/tsc.log 2>&1 || true

# Drop the shipped JS runtime next to the emitted bench so flat ./index.js,
# ./exports.js, ./serialize/*, ./chars.js all resolve.
cp src/index.js src/exports.js src/chars.js ./build/
cp -r src/serialize ./build/serialize
cp -r src/deserialize ./build/deserialize

for file in ./build/*.bench.js; do
  [[ -f "$file" ]] || continue
  printf '\n=== %s (v8/turbofan) ===\n' "$(basename "$file")"
  "$D8_BIN" --allow-natives-syntax --module "$file"
done

echo
echo "Finished benchmarks"

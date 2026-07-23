#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REMOTE_NAME="${REMOTE_NAME:-origin}"
DOCS_BRANCH="${DOCS_BRANCH:-docs}"
VERSION="${BENCHMARK_VERSION:-$(node -p "require('./package.json').version")}"
RUN_BENCHES=1
DRY_RUN=0
TMP_CHARTS_DIR="$(mktemp -d)"
TMP_WORKTREE_ROOT="$(mktemp -d)"
TMP_DOCS_DIR="$TMP_WORKTREE_ROOT/docs"
WORKTREE_ADDED=0

usage() {
  cat <<'EOF'
Usage: ./scripts/publish-benchmarks.sh [options]

Options:
  --no-run          Reuse existing build/logs reports
  --dry-run         Build and stage the versioned chart set without git changes
  --version <name>  Override package.json's version
  -h, --help        Show this help

Environment:
  REMOTE_NAME=origin
  DOCS_BRANCH=docs
  BENCHMARK_VERSION=<name>
  PUBLISH_REQUIRE_CLEAN=1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-run)
      RUN_BENCHES=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --version)
      [[ $# -lt 2 ]] && { echo "Missing value for --version" >&2; exit 1; }
      VERSION="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

VERSION="${VERSION#v}"
if [[ -z "$VERSION" || "$VERSION" == *"/"* || "$VERSION" == "." || "$VERSION" == ".." ]]; then
  echo "Invalid benchmark version: '$VERSION'" >&2
  exit 1
fi
DEST="v${VERSION}"

cleanup() {
  rm -rf "$TMP_CHARTS_DIR"
  if [[ "$WORKTREE_ADDED" == "1" ]]; then
    git worktree remove --force "$TMP_DOCS_DIR" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_WORKTREE_ROOT"
}
trap cleanup EXIT

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  if [[ "${PUBLISH_REQUIRE_CLEAN:-0}" == "1" ]]; then
    echo "Refusing to publish benchmarks with a dirty tracked working tree." >&2
    exit 1
  fi
  echo "⚠️  Charts will reflect uncommitted changes at HEAD $(git rev-parse --short HEAD)."
fi

if [[ $RUN_BENCHES -eq 1 ]]; then
  bash ./scripts/run-bench.sh publish --no-charts
else
  echo "Skipping benchmark runs. Reusing existing reports."
fi

echo "Building charts..."
JSON_TY_SYNC_CHARTS=0 bash ./scripts/build-charts.sh publish
node ./scripts/validate-benchmark-publication.mjs --charts
test -d ./build/charts
compgen -G "./build/charts/*" >/dev/null
cp -R ./build/charts/. "$TMP_CHARTS_DIR/"

if [[ $DRY_RUN -eq 1 ]]; then
  mkdir -p "$TMP_DOCS_DIR/charts/$DEST"
  cp -R "$TMP_CHARTS_DIR/." "$TMP_DOCS_DIR/charts/$DEST/"
  echo "Dry run prepared charts/$DEST:"
  find "$TMP_DOCS_DIR/charts/$DEST" -maxdepth 1 -type f -printf '  %f\n' | sort
  exit 0
fi

echo "Preparing ${DOCS_BRANCH} worktree..."
git fetch "$REMOTE_NAME" "$DOCS_BRANCH" >/dev/null 2>&1 || true
if git show-ref --verify --quiet "refs/remotes/${REMOTE_NAME}/${DOCS_BRANCH}"; then
  git worktree add --detach "$TMP_DOCS_DIR" "refs/remotes/${REMOTE_NAME}/${DOCS_BRANCH}" >/dev/null
  WORKTREE_ADDED=1
  (
    cd "$TMP_DOCS_DIR"
    git checkout -B "$DOCS_BRANCH" >/dev/null
  )
else
  git worktree add --detach "$TMP_DOCS_DIR" >/dev/null
  WORKTREE_ADDED=1
  (
    cd "$TMP_DOCS_DIR"
    git checkout --orphan "$DOCS_BRANCH" >/dev/null
    git rm -rf . >/dev/null 2>&1 || true
  )
fi

echo "Updating charts/$DEST on $DOCS_BRANCH..."
rm -rf "$TMP_DOCS_DIR/charts/$DEST"
mkdir -p "$TMP_DOCS_DIR/charts/$DEST"
cp -R "$TMP_CHARTS_DIR/." "$TMP_DOCS_DIR/charts/$DEST/"

(
  cd "$TMP_DOCS_DIR"
  git add -A charts
  if git diff --cached --quiet; then
    echo "No chart changes to publish for $DEST."
    exit 0
  fi
  git config user.name "${GIT_AUTHOR_NAME:-$(git config --get user.name || echo json-ty)}"
  git config user.email "${GIT_AUTHOR_EMAIL:-$(git config --get user.email || echo json-ty@example.com)}"
  git commit -m "Update benchmark charts for $DEST [skip ci]" >/dev/null
  git push "$REMOTE_NAME" "$DOCS_BRANCH"
)

RAW_ROOT="https://raw.githubusercontent.com/JairusSW/json-ty/refs/heads/${DOCS_BRANCH}/charts/${DEST}"
echo "Pinning README chart URLs to $RAW_ROOT..."
sed -i -E "s#src=\"(\\./benchmark/charts/|https://raw.githubusercontent.com/JairusSW/json-ty/refs/heads/${DOCS_BRANCH}/charts/([^/]*/)?)([^\"]+\\.(svg|png))\"#src=\"${RAW_ROOT}/\\3\"#g" README.md

echo "Benchmark charts published to ${REMOTE_NAME}/${DOCS_BRANCH}:charts/${DEST}/."
echo "README chart URLs were updated for review."

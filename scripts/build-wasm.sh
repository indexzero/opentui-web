#!/usr/bin/env bash
# Build opentui's wasm32-freestanding artifact and copy it into opentui-browser.
# Usage: build-wasm.sh [ReleaseSmall|Debug]  (default: ReleaseSmall)
set -euo pipefail

OPTIMIZE="${1:-ReleaseSmall}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZIG_DIR="$REPO_ROOT/packages/opentui/packages/core/src/zig"
DEST="$REPO_ROOT/packages/opentui-browser/src/opentui.wasm"

# Resolve the zig binary mise installed for this repo.
ZIG="${ZIG:-}"
if [[ -z "$ZIG" ]]; then
  if command -v mise >/dev/null 2>&1; then
    ZIG="$(mise which zig 2>/dev/null || true)"
  fi
fi
if [[ -z "$ZIG" ]]; then
  ZIG="zig"
fi

cd "$ZIG_DIR"
"$ZIG" build wasm "-Dwasm-optimize=$OPTIMIZE"

SRC="$ZIG_DIR/lib/wasm/opentui.wasm"
if [[ ! -f "$SRC" ]]; then
  echo "build-wasm: expected artifact not found at $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST"

bytes=$(wc -c < "$DEST" | tr -d ' ')
printf 'wrote %s (%s bytes, %s)\n' "${DEST#"$REPO_ROOT/"}" "$bytes" "$OPTIMIZE"

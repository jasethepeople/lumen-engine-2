#!/usr/bin/env bash
# Lumen engine — unified build.
#
# Compiles @lumen/contracts first, then every package in dependency order,
# then the packages that integrate them (@lumen/runtime, root entry point),
# and finally (re)creates the node_modules/@lumen/* workspace shims so the
# compiled output is runnable under plain Node (this mount cannot create
# symlinks, so `npm install` / workspace linking is unavailable — the shims
# are real directories with re-export files, see scripts/link-workspaces.mjs).
#
# TypeScript discovery order:
#   1. $LUMEN_TSCJS                         (explicit path to tsc.js)
#   2. <root>/node_modules/typescript/lib/tsc.js
#   3. $HOME/tools/typescript/lib/tsc.js
#
# @types/node (needed by @lumen/build) is provisioned from $HOME/tools/@types
# when the root node_modules copy is missing.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -n "${LUMEN_TSCJS:-}" ]; then
  TSCJS="$LUMEN_TSCJS"
elif [ -f "$ROOT/node_modules/typescript/lib/tsc.js" ]; then
  TSCJS="$ROOT/node_modules/typescript/lib/tsc.js"
elif [ -f "$HOME/tools/typescript/lib/tsc.js" ]; then
  TSCJS="$HOME/tools/typescript/lib/tsc.js"
else
  echo "error: cannot locate typescript (tsc.js). Set LUMEN_TSCJS." >&2
  exit 1
fi

# @types/node provisioning (no npm install possible on this mount).
if [ ! -d "$ROOT/node_modules/@types/node" ] && [ -d "$HOME/tools/@types/node" ]; then
  mkdir -p "$ROOT/node_modules/@types"
  cp -r "$HOME/tools/@types/node" "$ROOT/node_modules/@types/node"
fi

tsc() {
  echo "==> tsc -p $1"
  node "$TSCJS" -p "$1"
}

# 1. Frozen contracts first: several packages resolve @lumen/contracts to
#    contracts/dist/index.d.ts, so dist/ must exist before they compile.
tsc contracts/tsconfig.json

# 2. Module packages in dependency order (all depend only on contracts).
tsc packages/kernel/tsconfig.json
tsc packages/scene/tsconfig.json
tsc packages/rendering/tsconfig.json
tsc packages/assets/tsconfig.json
tsc packages/interaction/tsconfig.json
tsc packages/templates/tsconfig.json
tsc packages/config/tsconfig.json
tsc packages/codegen/tsconfig.json
tsc packages/build/tsconfig.json

# 3. Integration layer.
tsc packages/runtime/tsconfig.json
tsc tsconfig.build.json

# 4. Workspace shims for Node execution (no symlinks on this mount).
node scripts/link-workspaces.mjs

echo "build-all: OK"

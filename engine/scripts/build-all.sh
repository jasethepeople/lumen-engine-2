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

# 3b. Standalone tooling (depends only on contracts types; type-only imports
#     are erased, so the CLI stays zero-runtime-dep).
tsc app/cli/tsconfig.json

# 3c. App layer (@lumen/app-runtime: config/templates/codegen/runtime seam).
tsc app/runtime/tsconfig.json

# 3d. Marketplace core (@lumen/app-marketplace: template catalog/install flows).
tsc app/marketplace/tsconfig.json

# 3d. App tooling (@lumen/app-telemetry: local-only builder telemetry, zero deps).
tsc app/telemetry/tsconfig.json

# 3e. App layer (@lumen/app-settings: user settings, zero engine deps).
tsc app/settings/tsconfig.json
# 3e. App tooling (@lumen/app-assets: hosted asset pipeline — queue, CLI executor,
#     hybrid manifests, device profiles, asset library).
tsc app/assets/tsconfig.json

# 3f. App layer (@lumen/app-publish: static export + mock Vercel publish pipeline).
tsc app/publish/tsconfig.json

# 3f. App layer (@lumen/app-projects: builder project system, zero deps).
tsc app/projects/tsconfig.json

# 3g. App layer — billing & entitlements (zero-dep mock billing + gating).
tsc app/billing/tsconfig.json
tsc app/entitlements/tsconfig.json

# 3h. App layer (@lumen/app-onboarding: creator onboarding wizard; depends
#     on app-runtime/app-settings/app-projects + @lumen/config).
tsc app/onboarding/tsconfig.json

# 3i. App layer (@lumen/app-collaboration: local-only roles/membership,
#     presence, LWW merge suggestions, mock invitations, activity log).
tsc app/collaboration/tsconfig.json

# 3j. App layer (@lumen/app-dashboard: hosted publishing dashboard core —
#     aggregation, local-only analytics, previews, mock share links).
tsc app/dashboard/tsconfig.json
# 3j. App layer (@lumen/app-community: creator profiles, showcases, remix
#     flow with attribution, threaded local-only comments).
tsc app/community/tsconfig.json
# 3i. App layer (@lumen/app-designer: advanced motion designer core —
#     timeline editor model, serialization, motion graph, scrubbing; depends
#     on contracts/config/scene/runtime).
tsc app/designer/tsconfig.json
# 3i. App layer (@lumen/app-ai: local AI authoring assistant; depends on
#     @lumen/config + contracts, type-only on app-marketplace).
tsc app/ai/tsconfig.json

# 3k. Backend bindings (@lumen/backend-supabase: hosted Supabase facade +
#     offline mode; zero-dep, mirrors the app/* package surfaces).
tsc backend/supabase/tsconfig.json

# 4. Workspace shims for Node execution (no symlinks on this mount).

node scripts/link-workspaces.mjs

echo "build-all: OK"

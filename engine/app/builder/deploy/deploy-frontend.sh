#!/usr/bin/env bash
# deploy-frontend.sh — deploy the Lumen Builder SPA to Vercel (Phase 22).
#
# Steps: vercel CLI check → env-var hints → build → vercel deploy --prod.
#
# Build note (repo-documented /tmp recipe, see app/builder/README.md):
#   On mounts without symlink support `npm install` is unavailable; build in
#   /tmp with the skill template toolchain:
#     rsync -a --exclude .git --exclude node_modules <repo>/ /tmp/engine-ui/
#     ln -s <template node_modules> /tmp/engine-ui/app/builder/node_modules
#     cd /tmp/engine-ui/app/builder && ./node_modules/.bin/vite build
#   On a normal machine (and on Vercel's builders) plain `npm install` +
#   `npm run build` (tsc --noEmit + vite build) works — that is what
#   app/builder/vercel.json runs. Set PREBUILT=1 below to skip the local
#   build and deploy the committed app/builder/dist as-is.
#
# Usage:
#   bash app/builder/deploy/deploy-frontend.sh [--dry-run] [--prebuilt]
#
# Env: VERCEL_TOKEN (or `vercel login` first); VERCEL_ORG_ID / VERCEL_PROJECT_ID
# optional (otherwise `vercel link` on first run).

set -euo pipefail

if [ -t 1 ]; then
  C_STEP=$'\033[1;34m'; C_OK=$'\033[1;32m'; C_WARN=$'\033[1;33m'; C_ERR=$'\033[1;31m'; C_OFF=$'\033[0m'
else
  C_STEP=''; C_OK=''; C_WARN=''; C_ERR=''; C_OFF=''
fi
step() { printf '%s==>%s %s\n' "$C_STEP" "$C_OFF" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s warn%s %s\n' "$C_WARN" "$C_OFF" "$*"; }
die()  { printf '%s fail%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

DRY_RUN=0; PREBUILT=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --prebuilt) PREBUILT=1 ;;
    -h|--help) sed -n '1,25p' "$0"; exit 0 ;;
    *) die "unknown argument: $arg (supported: --dry-run --prebuilt)" ;;
  esac
done

run() {
  printf '  $'; printf ' %q' "$@"; printf '\n'
  if [ "$DRY_RUN" -eq 0 ]; then "$@"; fi
}

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

[ "$DRY_RUN" -eq 1 ] && warn "DRY-RUN: printing every command, executing nothing."

# ── 1. vercel CLI presence ──────────────────────────────────────────────────
step "Checking vercel CLI"
if ! command -v vercel >/dev/null 2>&1; then
  MSG="vercel CLI not found. Install:
    npm install -g vercel
  then authenticate: vercel login  (or export VERCEL_TOKEN)"
  if [ "$DRY_RUN" -eq 1 ]; then warn "$MSG"; else die "$MSG"; fi
fi
ok "vercel $(vercel --version 2>/dev/null || echo '(version unknown)')"

# ── 2. env-var hints ────────────────────────────────────────────────────────
step "Environment variables"
cat <<'EOF'
  Required in the Vercel project (Settings → Environment Variables):
    VITE_SUPABASE_URL        Supabase project URL
    VITE_SUPABASE_ANON_KEY   Supabase anon public key
  (createBackend() in backend/supabase/src/facade.ts auto-selects the hosted
   backend when both are present.)
  CLI equivalents:
    vercel env add VITE_SUPABASE_URL production
    vercel env add VITE_SUPABASE_ANON_KEY production
  See app/builder/deploy/vercel.env.example for the full list.
EOF
if [ -z "${VITE_SUPABASE_URL:-}" ] || [ -z "${VITE_SUPABASE_ANON_KEY:-}" ]; then
  warn "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set in this shell — fine if"
  warn "  already configured in the Vercel project; otherwise the app boots offline."
fi

# ── 3. build ────────────────────────────────────────────────────────────────
if [ "$PREBUILT" -eq 1 ]; then
  step "Using prebuilt dist/ (--prebuilt)"
  [ -d "$APP_DIR/dist" ] || die "dist/ not found; build first (see /tmp recipe above)."
else
  step "Building (npm run build — tsc --noEmit + vite build)"
  if [ -d "$APP_DIR/node_modules" ]; then
    run npm run build
  else
    warn "node_modules missing in $APP_DIR."
    warn "  On no-symlink mounts use the /tmp recipe in this script's header,"
    warn "  then re-run with --prebuilt. On a normal machine: npm install first."
    [ "$DRY_RUN" -eq 1 ] || die "cannot build without node_modules"
  fi
fi
ok "build artifacts ready in dist/"

# ── 4. deploy ───────────────────────────────────────────────────────────────
step "Deploying to Vercel (production)"
LINK_ARGS=()
[ -n "${VERCEL_ORG_ID:-}" ] && LINK_ARGS+=(--scope "$VERCEL_ORG_ID")
if [ ! -d "$APP_DIR/.vercel" ]; then
  warn "Project not linked yet — 'vercel link' will prompt once."
  run vercel link --yes "${LINK_ARGS[@]}"
fi
run vercel pull --yes --environment=production "${LINK_ARGS[@]}" || true
run vercel deploy --prod --yes "${LINK_ARGS[@]}"
ok "frontend deployed"

#!/usr/bin/env bash
# deploy-supabase.sh — one-command backend deploy for Lumen Engine (Phase 22).
#
# Steps: CLI check → env check → link → db push (migrations 0001–0009)
# → functions deploy (publish-pipeline, asset-pipeline, payouts; _shared is
# bundled automatically by the CLI) → secrets set → post-deploy validation
# (backend/deploy/validate-backend.mjs).
#
# Idempotent: migrations are idempotent (see backend/migrations/README.md),
# functions deploy and secrets set are repeatable, `supabase link` is a no-op
# when already linked.
#
# Usage:
#   bash backend/deploy/deploy-supabase.sh [--dry-run]
#
# Required env (see backend/deploy/.env.example):
#   SUPABASE_PROJECT_REF      project ref (dashboard URL: app.supabase.com/project/<ref>)
#   SUPABASE_ACCESS_TOKEN     personal access token — or run `supabase login` first
# Optional env consumed by later steps:
#   CRON_SECRET               shared with pg_cron (x-cron-secret header)
#   PAYOUT_THRESHOLD_CENTS    default 2500
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL — validation step

set -euo pipefail

# ── colors & step output ────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_STEP=$'\033[1;34m'; C_OK=$'\033[1;32m'; C_WARN=$'\033[1;33m'; C_ERR=$'\033[1;31m'; C_OFF=$'\033[0m'
else
  C_STEP=''; C_OK=''; C_WARN=''; C_ERR=''; C_OFF=''
fi
step() { printf '%s==>%s %s\n' "$C_STEP" "$C_OFF" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s warn%s %s\n' "$C_WARN" "$C_OFF" "$*"; }
die()  { printf '%s fail%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '1,30p' "$0"; exit 0 ;;
    *) die "unknown argument: $arg (supported: --dry-run)" ;;
  esac
done

# run: echo-and-execute; in dry-run mode only prints.
run() {
  printf '  $'
  printf ' %q' "$@"
  printf '\n'
  if [ "$DRY_RUN" -eq 0 ]; then "$@"; fi
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

[ "$DRY_RUN" -eq 1 ] && warn "DRY-RUN: printing every command, executing nothing."

# ── 1. supabase CLI presence ────────────────────────────────────────────────
step "Checking supabase CLI"
if ! command -v supabase >/dev/null 2>&1; then
  MSG="supabase CLI not found. Install:
    macOS:   brew install supabase/tap/supabase
    npm:     npm install -g supabase
    other:   https://supabase.com/docs/guides/cli/getting-started"
  if [ "$DRY_RUN" -eq 1 ]; then warn "$MSG"; else die "$MSG"; fi
fi
ok "supabase $(supabase --version 2>/dev/null || echo '(version unknown)')"

# ── 2. credentials ─────────────────────────────────────────────────────────
step "Checking credentials"
if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  MSG="SUPABASE_PROJECT_REF is required (dashboard → Project Settings → General → Reference ID)."
  if [ "$DRY_RUN" -eq 1 ]; then warn "$MSG"; SUPABASE_PROJECT_REF="<project-ref>"; else die "$MSG"; fi
fi
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  warn "SUPABASE_ACCESS_TOKEN not set — assuming you already ran 'supabase login'."
  warn "  (generate a token at https://supabase.com/dashboard/account/tokens)"
fi
ok "project ref: $SUPABASE_PROJECT_REF"

# ── 3. link ────────────────────────────────────────────────────────────────
step "Linking project"
run supabase link --project-ref "$SUPABASE_PROJECT_REF"
ok "linked"

# ── 4. migrations 0001–0009 ────────────────────────────────────────────────
# The CLI migration runner expects supabase/migrations/. Our canonical,
# ordered SQL lives in backend/migrations/ (see its README); point the CLI at
# it via a config that sets the migrations dir, falling back to a symlink.
step "Pushing database migrations (0001–0009)"
MIG_DIR="$ROOT/backend/migrations"
SUPA_DIR="$ROOT/supabase"
if [ ! -d "$SUPA_DIR" ] && [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$SUPA_DIR"
  if [ ! -e "$SUPA_DIR/migrations" ]; then
    # Symlink preferred; copy as fallback on mounts without symlink support.
    if ln -s "$MIG_DIR" "$SUPA_DIR/migrations" 2>/dev/null; then
      ok "symlinked supabase/migrations -> backend/migrations"
    else
      cp -r "$MIG_DIR" "$SUPA_DIR/migrations"
      ok "copied backend/migrations -> supabase/migrations (no symlink support)"
    fi
  fi
  if [ ! -f "$SUPA_DIR/config.toml" ]; then
    cat > "$SUPA_DIR/config.toml" <<'EOF'
# Minimal Supabase CLI config for `supabase db push` / `functions deploy`.
# Migrations are the canonical files from backend/migrations/ (0001–0009).
project_id = "placeholder-overridden-by-link"
EOF
  fi
fi
# Supabase CLI requires versioned filenames (timestamp_name.sql); our files
# use fixed numeric prefixes. `db push` accepts them when they sort correctly,
# but to be robust across CLI versions push each file explicitly with psql
# when SUPABASE_DB_URL is provided, else use the CLI runner.
if [ -n "${SUPABASE_DB_URL:-}" ]; then
  for f in "$MIG_DIR"/000*.sql; do
    run psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
  done
else
  run supabase db push
fi
ok "migrations applied"

# ── 5. edge functions (_shared is bundled by the CLI automatically) ────────
step "Deploying edge functions"
for fn in publish-pipeline asset-pipeline payouts; do
  # All three functions authenticate in-code (user JWT / service-role bearer /
  # cron secret). Platform JWT verification would block them first with
  # UNAUTHORIZED_INVALID_JWT_FORMAT, so it must be disabled per function.
  run supabase functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt
  ok "deployed $fn (--no-verify-jwt)"
done

# ── 6. secrets ─────────────────────────────────────────────────────────────
step "Setting edge-function secrets"
CRON_SECRET="${CRON_SECRET:-}"
if [ -z "$CRON_SECRET" ]; then
  # Generate a strong secret on first run; printed so the user can store it.
  CRON_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  warn "CRON_SECRET not set — generated one for this deploy (store it safely):"
  warn "  CRON_SECRET=$CRON_SECRET"
fi
PAYOUT_THRESHOLD_CENTS="${PAYOUT_THRESHOLD_CENTS:-2500}"
run supabase secrets set \
  "CRON_SECRET=$CRON_SECRET" \
  "PAYOUT_THRESHOLD_CENTS=$PAYOUT_THRESHOLD_CENTS" \
  --project-ref "$SUPABASE_PROJECT_REF"
ok "secrets set (CRON_SECRET, PAYOUT_THRESHOLD_CENTS=$PAYOUT_THRESHOLD_CENTS)"

# SUPABASE_SERVICE_ROLE_KEY must be the LEGACY service_role JWT (eyJ…,
# Project Settings → API → service_role). New-format sb_secret_… keys are
# rejected by the platform JWT layer and cause UNAUTHORIZED_INVALID_JWT_FORMAT.
if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  case "$SUPABASE_SERVICE_ROLE_KEY" in
    eyJ*) run supabase secrets set "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY" --project-ref "$SUPABASE_PROJECT_REF"
          ok "SUPABASE_SERVICE_ROLE_KEY secret set (legacy JWT)";;
    *)    warn "SUPABASE_SERVICE_ROLE_KEY is not an eyJ… JWT — NOT set. Fix it in Project Settings → API.";;
  esac
fi

# ── 7. post-deploy validation ───────────────────────────────────────────────
step "Running post-deploy validation (validate-backend.mjs)"
if [ "$DRY_RUN" -eq 1 ]; then
  run node "$ROOT/backend/deploy/validate-backend.mjs"
else
  # Degrades gracefully: exits 0 with SKIPPED summary when env is absent.
  node "$ROOT/backend/deploy/validate-backend.mjs"
fi
ok "deploy complete"

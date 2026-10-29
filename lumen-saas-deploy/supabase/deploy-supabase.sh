#!/usr/bin/env bash
# Deploy all Lumen edge functions to Supabase with correct auth configuration.
# Usage:
#   export SUPABASE_PROJECT_REF=<ref>
#   export SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...   # legacy service_role JWT
#   export CRON_SECRET=$(openssl rand -hex 32)        # or let it auto-generate
#   bash supabase/deploy-supabase.sh [--dry-run]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*"; }
run()  { if [ "$DRY_RUN" -eq 1 ]; then printf '  $ %q' "$@"; printf '\n'; else "$@"; fi }

command -v supabase >/dev/null 2>&1 || { echo "supabase CLI missing — install: https://supabase.com/docs/guides/cli"; exit 1; }
: "${SUPABASE_PROJECT_REF:?export SUPABASE_PROJECT_REF=<project-ref>}"

say "Linking project $SUPABASE_PROJECT_REF"
run supabase link --project-ref "$SUPABASE_PROJECT_REF"

# Secrets. SUPABASE_SERVICE_ROLE_KEY must be the LEGACY service_role JWT
# (eyJ…, Project Settings → API → service_role). New-format sb_secret_… keys
# fail the platform JWT layer with UNAUTHORIZED_INVALID_JWT_FORMAT.
say "Setting secrets"
CRON_SECRET="${CRON_SECRET:-$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
PAYOUT_THRESHOLD_CENTS="${PAYOUT_THRESHOLD_CENTS:-2500}"
if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  case "$SUPABASE_SERVICE_ROLE_KEY" in
    eyJ*) run supabase secrets set "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY" --project-ref "$SUPABASE_PROJECT_REF" ;;
    *)    warn "SUPABASE_SERVICE_ROLE_KEY is not an eyJ… JWT — skipped. Set the legacy service_role key." ;;
  esac
else
  warn "SUPABASE_SERVICE_ROLE_KEY not exported — skipped (functions need it)."
fi
run supabase secrets set "CRON_SECRET=$CRON_SECRET" --project-ref "$SUPABASE_PROJECT_REF"
run supabase secrets set "PAYOUT_THRESHOLD_CENTS=$PAYOUT_THRESHOLD_CENTS" --project-ref "$SUPABASE_PROJECT_REF"
say "CRON_SECRET for Vercel/env records: $CRON_SECRET"

# All functions authenticate IN CODE (user JWT via auth.getUser, service-role
# bearer, or cron secret). Platform JWT verification would block requests
# before the function runs, so it MUST be disabled per function.
say "Deploying functions (--no-verify-jwt)"
for fn in publish-pipeline asset-pipeline payouts; do
  run supabase functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt
  say "deployed $fn (--no-verify-jwt)"
done

say "Done. Verify with:"
echo "  curl -i -X POST \"\$SUPABASE_URL/functions/v1/payouts\" -H \"x-cron-secret: $CRON_SECRET\""

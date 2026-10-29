# Lumen SaaS — Corrected Supabase + Vercel Integration (final fixed system)

Root cause of UNAUTHORIZED_INVALID_JWT_FORMAT: Supabase platform JWT verification
runs BEFORE the function and rejects requests that don't carry a valid
anon/service JWT in the expected format. All three functions authenticate
in-code, so platform verification must be disabled per function
(`--no-verify-jwt`), and the service role key must be the legacy `eyJ…` JWT.

## File structure (corrected)

```
backend/
├── SCHEMA.md
├── migrations/0001–0009.sql
├── deploy/
│   ├── deploy-supabase.sh        # now deploys with --no-verify-jwt + sets service-role secret
│   ├── validate-backend.mjs
│   └── .env.example              # corrected
├── functions/
│   ├── _shared/{cors,auth,supabase,responses,hash}.ts   # auth.ts: keysEqual + requireServiceRole
│   ├── publish-pipeline/index.ts  # auth: user JWT via auth.getUser (in-code)
│   ├── asset-pipeline/index.ts    # auth: service-role bearer via requireServiceRole
│   └── payouts/index.ts           # auth: x-cron-secret OR service-role bearer
└── supabase/                      # typed client bindings (unchanged)
app/builder/
├── api/publish.ts                 # Vercel edge route → publish-pipeline (forwards user JWT)
├── api/assets.ts                  # Vercel edge route → asset-pipeline (service-role, server-side)
├── deploy/vercel.env.example      # corrected mapping
└── vercel.json
```

## Exact steps to run, in order

```bash
# 0. Keys — Project Settings → API. Use the LEGACY eyJ… service_role JWT.
export SUPABASE_PROJECT_REF=<project-ref>
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_ANON_KEY=eyJhbGciOi...
export SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...   # service_role, eyJ… — NOT sb_secret_…

# 1. CLI auth + link
supabase login
supabase link --project-ref $SUPABASE_PROJECT_REF

# 2. Migrations (or: bash backend/deploy/deploy-supabase.sh for 2–5 in one go)
supabase db push

# 3. Secrets (service-role key + cron + threshold)
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY --project-ref $SUPABASE_PROJECT_REF
supabase secrets set CRON_SECRET=$(openssl rand -hex 32) PAYOUT_THRESHOLD_CENTS=2500 --project-ref $SUPABASE_PROJECT_REF

# 4. Deploy functions with platform JWT verification DISABLED
supabase functions deploy publish-pipeline --project-ref $SUPABASE_PROJECT_REF --no-verify-jwt
supabase functions deploy asset-pipeline  --project-ref $SUPABASE_PROJECT_REF --no-verify-jwt
supabase functions deploy payouts         --project-ref $SUPABASE_PROJECT_REF --no-verify-jwt

# 5. Validate backend
node backend/deploy/validate-backend.mjs

# 6. Vercel env (server-only service key; browser gets only VITE_* anon)
vercel env add VITE_SUPABASE_URL production          <<< "$SUPABASE_URL"
vercel env add VITE_SUPABASE_ANON_KEY production     <<< "$SUPABASE_ANON_KEY"
vercel env add VITE_PUBLISH_PIPELINE_URL production  <<< "/api/publish"
vercel env add VITE_ASSET_PIPELINE_URL production    <<< "/api/assets"
vercel env add SUPABASE_SERVICE_ROLE_KEY production  <<< "$SUPABASE_SERVICE_ROLE_KEY"
vercel env add CRON_SECRET production                <<< "<same CRON_SECRET>"

# 7. Deploy frontend (from app/builder)
cd app/builder && vercel deploy --prod

# 8. Schedule the asset-queue drain (Vercel cron) — see vercel.json snippet below
```

## Corrected curl calls

```bash
# publish-pipeline — end user JWT (from supabase.auth sign-in on the client)
curl -X POST "$SUPABASE_URL/functions/v1/publish-pipeline" \
  -H "authorization: Bearer $USER_JWT" \
  -H "content-type: application/json" \
  -d '{"project_id":"<uuid>","config":{…}}'

# asset-pipeline — service-role bearer (server-side only)
curl -X POST "$SUPABASE_URL/functions/v1/asset-pipeline" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "content-type: application/json" \
  -d '{}'

# payouts — cron secret (matches pg_cron invocation)
curl -X POST "$SUPABASE_URL/functions/v1/payouts" \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{}'

# payouts — or service-role bearer
curl -X POST "$SUPABASE_URL/functions/v1/payouts" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -d '{}'
```

## Pipeline wiring (corrected)

- Browser → `POST /api/publish` (Vercel) → forwards **user JWT** → `publish-pipeline` (verifies via `auth.getUser`, role-checks owner/editor, budget-enforced bundle → `bundles` bucket → `publishes` row).
- Vercel cron → `POST /api/assets` (header `x-cron-secret`) → `asset-pipeline` with **service-role bearer** (server-side only) → drains `asset_jobs` skip-locked → `assets` bucket + manifest.
- pg_cron (03:00 daily) → `payouts` with `x-cron-secret` → settles `revenue_ledger` 70/30 into `payouts`.
- Browser realtime: presence channels `presence:project:{id}` + postgres_changes on `merge_suggestions`/`comments`/`asset_jobs`.

## vercel.json cron addition

```json
{
  "crons": [{ "path": "/api/assets", "schedule": "*/15 * * * *" }]
}
```
(Vercel cron cannot set custom headers; protect `/api/assets` with the
`CRON_SECRET` check already in the route — configure Vercel cron to send it
via a wrapper, or accept Vercel's `x-vercel-cron` header and map it in the route.)

## Integration notes

- All three functions are `--no-verify-jwt`; auth is enforced in-code (`_shared/auth.ts`): user JWT via `anonClient(jwt).auth.getUser`, service-role via timing-safe `keysEqual` compare to `SUPABASE_SERVICE_ROLE_KEY`, cron via `x-cron-secret`.
- The service-role value everywhere must be the same legacy `eyJ…` JWT: Supabase secret, Vercel server-only env, and your local `.env`.
- `sb_secret_…` new-format keys will fail the platform layer and are not accepted by these functions — use the legacy JWT.
- Browser bundle never receives the service-role key (VITE_ filter).
- CI/CD: GitHub Action = steps 1–5 above with `SUPABASE_ACCESS_TOKEN` as a repo secret; Vercel Git integration handles the frontend on push to main.

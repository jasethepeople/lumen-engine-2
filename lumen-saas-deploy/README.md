# Lumen SaaS — Supabase + Vercel deployment bundle

Complete, corrected, drop-in system. Three Supabase Edge Functions with
in-code auth (platform JWT verification disabled via `--no-verify-jwt`),
two Vercel edge proxies, deployment automation, and env mapping.

## Folder tree

```
.
├── README.md
├── supabase/
│   ├── .env.example
│   ├── deploy-supabase.sh
│   └── functions/
│       ├── _shared/
│       │   ├── auth.ts        # keysEqual, requireServiceRole, requireCronSecret, bearerToken, getUser, requireRole, AuthError
│       │   ├── cors.ts
│       │   ├── hash.ts
│       │   ├── responses.ts
│       │   └── supabase.ts    # serviceClient (bypasses RLS) + anonClient (caller JWT)
│       ├── publish-pipeline/index.ts   # user JWT auth; budget-enforced static bundle → bundles bucket → publishes row
│       ├── asset-pipeline/index.ts     # service-role bearer; drains asset_jobs (skip-locked) → assets bucket + manifest
│       └── payouts/index.ts            # x-cron-secret OR service-role; settles revenue_ledger 70/30 → payouts
└── app/builder/
    ├── .env.example
    ├── vercel.json
    └── api/
        ├── publish.ts         # runtime=edge; forwards user JWT → publish-pipeline
        └── assets.ts          # runtime=edge; CRON_SECRET-gated; injects service-role → asset-pipeline
```

## Auth model (the fix)

Supabase platform JWT verification runs BEFORE a function executes and was
rejecting requests with `UNAUTHORIZED_INVALID_JWT_FORMAT`. Every function
here authenticates in code, so each is deployed with `--no-verify-jwt`:

| Function | Accepted credentials |
|---|---|
| publish-pipeline | End-user Supabase JWT (`authorization: Bearer <user-jwt>`), verified via `anonClient(jwt).auth.getUser`; owner/editor role check on the project |
| asset-pipeline | `authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — timing-safe `keysEqual` compare |
| payouts | `x-cron-secret: <CRON_SECRET>` **or** service-role bearer |

`SUPABASE_SERVICE_ROLE_KEY` must be the **legacy `eyJ…` service_role JWT**
(Project Settings → API). The new `sb_secret_…` key format fails the platform
layer — do not use it.

## Setup, in order

```bash
# 0. Keys (Supabase Dashboard → Project Settings → API)
export SUPABASE_PROJECT_REF=<project-ref>
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_ANON_KEY=eyJhbGciOi...
export SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...   # legacy service_role JWT

# 1. Database: apply your migrations (tables asset_jobs, assets, publishes,
#    revenue_ledger, payouts, projects, project_members per the schema),
#    e.g. `supabase db push` from your migrations repo.

# 2. Secrets + deploy functions
bash supabase/deploy-supabase.sh            # add --dry-run to preview

# 3. Vercel env (Project → Settings → Environment Variables)
#    VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
#    VITE_PUBLISH_PIPELINE_URL=/api/publish, VITE_ASSET_PIPELINE_URL=/api/assets
#    SUPABASE_SERVICE_ROLE_KEY (server-only), CRON_SECRET (same as Supabase)

# 4. Vercel cron (optional queue drain): edit app/builder/vercel.json cron
#    path to "/api/assets?secret=<CRON_SECRET>" (literal value).

# 5. Deploy frontend from app/builder
vercel deploy --prod
```

## Curl reference

```bash
# publish-pipeline — end-user JWT
curl -X POST "$SUPABASE_URL/functions/v1/publish-pipeline" \
  -H "authorization: Bearer $USER_JWT" -H "content-type: application/json" \
  -d '{"project_id":"<uuid>","config":{}}'

# asset-pipeline — service-role bearer (server-side only)
curl -X POST "$SUPABASE_URL/functions/v1/asset-pipeline" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "content-type: application/json" -d '{}'

# payouts — cron secret
curl -X POST "$SUPABASE_URL/functions/v1/payouts" \
  -H "x-cron-secret: $CRON_SECRET" -d '{}'
```

## Input contracts

- `publish-pipeline` POST JSON: `{ project_id: string(uuid), config: object }` → 201 `{ publish: {...} }`; 400 with `violations` on budget exceed; 401/403 on auth.
- `asset-pipeline` POST JSON: `{}` (drain mode) or `{ job_id, probe?, variants? }` (external-worker mode) → `{ claimed, jobs: [{job_id, status}] }`.
- `payouts` POST: empty body → `{ authors, total_cents, payouts, skipped }`.

## Notes

- `_shared/` lives under `supabase/functions/` because the Supabase bundler
  only includes files reachable from the function's relative imports.
- Heavy transcode is intentionally out of the edge function: an external
  worker calls `asset-pipeline` per job with probe/variant data; the function
  handles queue state, storage, and manifests.
- The browser bundle never receives the service-role key — Vite only exposes
  `VITE_*` vars; the key is read exclusively by the `api/` edge routes.

# DEPLOYMENT.md — Lumen Engine SaaS Deployment Runbook (Phase 22)

Master runbook for deploying the Lumen SaaS stack: **Supabase** (Postgres,
RLS, storage, edge functions, cron) + **Vercel** (builder SPA). Everything
here maps 1:1 to runnable automation in this repo — no step requires
hand-written SQL beyond what ships in `backend/migrations/`.

| Artifact | Path |
| --- | --- |
| Backend deploy script | `backend/deploy/deploy-supabase.sh` |
| Backend validation harness | `backend/deploy/validate-backend.mjs` |
| Backend env template | `backend/deploy/.env.example` |
| Frontend Vercel config | `app/builder/vercel.json` |
| Frontend env template | `app/builder/deploy/vercel.env.example` |
| Frontend deploy script | `app/builder/deploy/deploy-frontend.sh` |
| Schema contract (binding) | `backend/SCHEMA.md` |

---

## (a) Prerequisites & account setup (free tiers)

### Supabase (free tier)
1. Go to https://supabase.com → **Start your project** → sign in with GitHub.
2. **New project** → pick/create an organization (Free plan) → set **Name**,
   **Database Password** (save it), **Region** closest to your users →
   **Create new project** (~2 min provisioning).
3. Note the **Project ref** from the URL: `app.supabase.com/project/<ref>`.
4. Collect credentials (all under **Project Settings**):
   - **Data API → Project URL** → `SUPABASE_URL`
   - **API Keys → anon public** → `SUPABASE_ANON_KEY`
   - **API Keys → service_role** → `SUPABASE_SERVICE_ROLE_KEY` (secret!)
   - **API Keys → JWT Secret** → `SUPABASE_JWT_SECRET`
   - **Database → Connection string (direct)** → `SUPABASE_DB_URL` (optional)
5. CLI token: https://supabase.com/dashboard/account/tokens →
   **Generate token** → `SUPABASE_ACCESS_TOKEN` (or run `supabase login`).
6. Install the CLI: `brew install supabase/tap/supabase` or
   `npm install -g supabase`.

### Vercel (free tier / Hobby)
1. Go to https://vercel.com → **Sign Up** → continue with GitHub.
2. **Add New… → Project** → import this repo (or use the CLI flow in (c);
   the CLI `vercel link` creates the project without importing).
3. Install the CLI: `npm install -g vercel`, then `vercel login`.
4. For CI/token use: https://vercel.com/account/tokens → `VERCEL_TOKEN`.

### Local prerequisites
- Node ≥ 20, bash, git. `psql` (optional — enables the direct-DB migration
  path and pg-level RLS/cron validation).
- `cp backend/deploy/.env.example .env` and fill it in. **Never commit `.env`.**

---

## (b) Backend deploy — mapped to the Phase-22 requirements

One command performs steps 1–6 (idempotent, `set -euo pipefail`, colored
output, `--dry-run` prints every command without executing):

```sh
set -a; . ./.env; set +a            # load SUPABASE_PROJECT_REF etc.
bash backend/deploy/deploy-supabase.sh --dry-run   # preview
bash backend/deploy/deploy-supabase.sh             # deploy
```

| # | Requirement | How it's done |
| --- | --- | --- |
| 1 | **Migrations 0001–0009** | `supabase link` + `supabase db push` (script symlinks `supabase/migrations` → `backend/migrations/`; with `SUPABASE_DB_URL` set it applies each `000*.sql` via `psql -v ON_ERROR_STOP=1` instead). Order/contents per `backend/migrations/README.md`. |
| 2 | **Edge functions** | `supabase functions deploy publish-pipeline asset-pipeline payouts`. The CLI bundles `backend/functions/_shared/` automatically. |
| 3 | **Storage buckets** | Created by migration `0008_storage.sql`: `assets` (private), `bundles` (private), `thumbnails` (public read) + `storage.objects` policies. Verified by the harness. |
| 4 | **Realtime** | Presence is client-channel-based (`presence:project:{id}`) — no server config. For `postgres_changes` live UI on `merge_suggestions`, `comments`, `asset_jobs`, enable replication once: dashboard → **Database → Replication** → enable those three tables for the `supabase_realtime` publication (or `alter publication supabase_realtime add table ...`). No other server setup per `SCHEMA.md`. |
| 5 | **Cron** | Migration `0009_cron.sql` schedules `settle_payouts` (daily 03:00 → SQL `settle_scheduled_payouts()`; comments show the pg_net variant that calls the `payouts` edge function with `x-cron-secret`) and `expire_invitations` (hourly). |
| 6 | **Queue** | `asset_jobs` is the queue table; workers claim with `select ... for update skip locked` (see `claim_asset_job` SQL in `backend/functions/asset-pipeline/index.ts` header, and §f). |
| 7 | **Env vars / secrets** | Script runs `supabase secrets set CRON_SECRET=… PAYOUT_THRESHOLD_CENTS=…` (auto-generates `CRON_SECRET` if unset). `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are auto-provisioned to functions by Supabase. All 7 spec vars documented in `backend/deploy/.env.example`. |
| 8 | **Post-deploy validation** | Script tails into `node backend/deploy/validate-backend.mjs` (see (e)). |

Re-running the script is safe: migrations are idempotent (`create table if
not exists`, `drop policy if exists`, guarded `cron.unschedule`), function
deploys and `secrets set` are repeatable.

---

## (c) Frontend deploy (Vercel)

```sh
bash app/builder/deploy/deploy-frontend.sh --dry-run   # preview
bash app/builder/deploy/deploy-frontend.sh             # build + vercel deploy --prod
```

- `app/builder/vercel.json`: static SPA — build `npm run build` (tsc
  typecheck + vite build), output `dist`, SPA rewrite `/(.*) → /index.html`,
  immutable caching for `/assets/*`, no-store-ish for `index.html`.
- **Build note:** on mounts without symlink support `npm install` fails;
  use the repo-documented /tmp recipe (comments in `deploy-frontend.sh` and
  `app/builder/README.md`), then re-run with `--prebuilt`. Vercel's own
  builders run `npm install` normally — no action needed there.
- Env vars (Vercel project → Settings → Environment Variables, or
  `vercel env add <NAME> production`): `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` — full list incl. `NEXT_PUBLIC_*` aliases and the
  server-only `SUPABASE_SERVICE_ROLE_KEY` warning in
  `app/builder/deploy/vercel.env.example`.

---

## (d) Integration — hosted backend auto-select

`backend/supabase/src/facade.ts` exports `createBackend(env)`: when both
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present it returns the
hosted `createLumenBackend({client})` (Supabase-backed auth, projects,
assets, publish, marketplace, collaboration, dashboard, community, billing,
entitlements, telemetry); otherwise the zero-config `createOfflineBackend()`
(memory adapters). So the moment the two VITE_* vars are set in Vercel, the
deployed builder talks to the hosted backend — no code change.

---

## (e) Full validation checklist

Run after any deploy (and before tagging a release):

```sh
# 1. Backend bindings unit tests (offline, no credentials needed)
node --test backend/supabase/test/

# 2. Live backend validation (degrades to SKIPPED + exit 0 without env)
node backend/deploy/validate-backend.mjs            # add --json for CI
#    checks: 19 tables via PostgREST, RLS per table (pg when SUPABASE_DB_URL,
#    anon-probe heuristic otherwise), buckets + public flags, edge functions
#    responding (OPTIONS), payouts secret enforcement, cron jobs in cron.job.

# 3. Engine build + workspace shims
bash scripts/build-all.sh

# 4. E2E smoke tests
node --test tests/e2e/

# 5. Size budgets (example builds must report budgets passed: true)
node examples/simple-site/build-example.mjs         # + other examples/*

# 6. SaaS offline end-to-end smoke (Phase-22 wiring agent)
node --test tests/saas-smoke/

# 7. Dry-run the deploy scripts to confirm the command surface
bash backend/deploy/deploy-supabase.sh --dry-run
bash app/builder/deploy/deploy-frontend.sh --dry-run
```

---

## (f) Rollback & troubleshooting

### Rollback
- **Migrations:** no down migrations (by design). Drop objects in reverse
  order `0009` → `0002` (`drop table … cascade`, `cron.unschedule('settle_payouts')`,
  `cron.unschedule('expire_invitations')`) — details in
  `backend/migrations/README.md`. Re-applying after partial application is
  safe (idempotent).
- **Edge functions:** redeploy the previous git revision:
  `git checkout <sha> -- backend/functions && supabase functions deploy …`.
- **Frontend:** Vercel dashboard → Deployments → previous deployment →
  **Promote to Production** (or `vercel rollback`).
- **Publishes:** user-facing publish rollback is a data operation
  (`publishes.status='rolled-back'`), handled by the publish domain, not this
  runbook.

### Common errors
- **`infinite recursion detected in policy for relation "project_members"`**
  (RLS recursion): a policy on `project_members` is sub-selecting
  `project_members` itself. The shipped policies in `0007_rls.sql` avoid this
  via security-definer helpers / non-recursive predicates — if you edited
  policies, move membership checks into a `security definer` function
  (`is_project_member(project_id)`) that bypasses RLS on the lookup.
- **`asset-pipeline` warns `claim_asset_job rpc error, falling back`:**
  the optional claim RPC isn't installed; the function falls back to a
  best-effort claim loop. For strict `for update skip locked` claiming apply
  this optional migration (copied from the function header comment):

  ```sql
  create or replace function claim_asset_job()
  returns setof asset_jobs language sql as $$
    update asset_jobs
       set status = 'running', updated_at = now()
     where id = (
       select id from asset_jobs
        where status = 'queued'
        order by created_at
        limit 1
        for update skip locked
     )
    returning *;
  $$;
  ```
- **`supabase db push` complains about migration filenames:** the CLI wants
  `<timestamp>_name.sql`. Use the `SUPABASE_DB_URL` psql path in the deploy
  script, or rename to timestamped prefixes when symlinking.
- **Edge function 401s from the browser:** you're calling with the anon key
  but no user JWT (publish-pipeline needs a user JWT; asset-pipeline is
  service-role only; payouts needs `x-cron-secret`). See contracts in
  `backend/functions/README.md`.
- **Realtime not updating:** table not added to the `supabase_realtime`
  publication (see (b) #4), or RLS denies the selecting user.
- **Cron not firing:** `select * from cron.job;` / `cron.job_run_details;`
  (needs `SUPABASE_DB_URL`); confirm pg_cron is enabled (default on Supabase).
- **`validate-backend.mjs` reports FAIL on RLS via anon probe:** the
  heuristic can't distinguish "public-read policy" from "RLS off" without pg
  access — set `SUPABASE_DB_URL` for the authoritative `pg_tables.rowsecurity`
  check.

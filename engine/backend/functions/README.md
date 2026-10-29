# backend/functions — Supabase Edge Functions (Deno + TypeScript)

Three functions plus `_shared/` helpers. Binding schema contract:
`backend/SCHEMA.md` — table/column names and bucket layouts follow it exactly.

```
functions/
  _shared/           cors.ts, auth.ts, supabase.ts, responses.ts, hash.ts
  publish-pipeline/  POST {project_id, config} → static bundle → publishes row
  asset-pipeline/    worker: drains asset_jobs → manifest → assets row update
  payouts/           cron: settle revenue_ledger → scheduled payouts
```

## Deploy

```
supabase link --project-ref <ref>
supabase functions deploy publish-pipeline
supabase functions deploy asset-pipeline
supabase functions deploy payouts
```

## Environment variables

| var | used by | notes |
|---|---|---|
| `SUPABASE_URL` | all | auto-set by Supabase |
| `SUPABASE_ANON_KEY` | publish-pipeline | JWT-scoped client for auth |
| `SUPABASE_SERVICE_ROLE_KEY` | all | privileged writes; also the bearer credential for asset-pipeline |
| `CRON_SECRET` | payouts | `x-cron-secret` header shared with pg_cron |
| `PAYOUT_THRESHOLD_CENTS` | payouts | default `2500` ($25) |
| `ALLOWED_ORIGINS` | _shared/cors | comma-separated; default `*` |

## Contracts

### publish-pipeline — POST, user JWT, owner/editor only

```
curl -X POST $SUPABASE_URL/functions/v1/publish-pipeline \
  -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"project_id":"<uuid>","config":{"scenes":[]}}'
```

- `201` `{ publish, budgets }` — bundle uploaded to `bundles/{project_id}/{publish_id}/`
  (index.html + manifest.json with per-file sha256), `publishes` row inserted
  with `config_hash` (sha256 of canonical config JSON) and `bundle_path`.
- `400` with `detail.violations` when a size budget fails. Budgets mirror
  `packages/build/src/budgets.ts`: js-gz ≤ 170 KiB, css-gz ≤ 40 KiB,
  critical-assets ≤ 1.2 MiB (+10% warn tolerance).
- `401`/`403`/`404` for auth/role/missing project.

**Publish bundling is a documented seam for the real engine pipeline.**
`assembleBundle()` emits a minimal static export (index.html embedding the
config JSON + pinned import map to the vendored runtime placeholder). The
real `@lumen/build` pipeline runs in a Node worker (engine packages are not
available in Deno); swap the seam body for an enqueue/callback — budgets,
hashing, storage, and the publishes insert are pipeline-agnostic.

### asset-pipeline — POST, service-role bearer only

```
curl -X POST $SUPABASE_URL/functions/v1/asset-pipeline \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{}'
```

Drains up to 5 `asset_jobs` (preferred: `rpc('claim_asset_job')` —
`select ... for update skip locked` SQL in the index.ts header comment;
fallback: claim loop). Marks running → done/failed, uploads variant
placeholders + manifest.json to `assets/{owner_id}/{project_id}/{asset_id}/`,
updates the `assets` row. ffmpeg cannot run on edge; an external worker does
heavy transcode and POSTs `{job_id, probe, variants}` per job to this
endpoint. Response: `{ claimed, jobs: [{job_id, status, error?}] }`.

### payouts — POST, `x-cron-secret` header (pg_cron `settle_payouts`, daily 03:00)

```
curl -X POST $SUPABASE_URL/functions/v1/payouts -H "x-cron-secret: $CRON_SECRET"
```

Selects unsettled `revenue_ledger` rows, groups by `author_id` summing
`creator_cents` (70% share), inserts `payouts` rows
(`status='scheduled'`, period bounds) for authors ≥ threshold, marks ledger
rows settled. Response: `{ authors, total_cents, payouts, skipped }`.

## Validation

Each function ships a `test.md` with the full request/response contract and a
local mock-harness note (`deno serve` against `supabase start` or a mock
PostgREST/storage server). `deno check` was not run in this environment
(deno absent) — code was self-reviewed for Deno deploy compatibility.

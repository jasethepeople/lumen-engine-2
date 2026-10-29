# publish-pipeline — request/response contract

## Request

```
POST /functions/v1/publish-pipeline
Authorization: Bearer <user JWT>
Content-Type: application/json

{ "project_id": "<uuid>", "config": { ... } }
```

Caller must be `owner` or `editor` of the project (checked against
`project_members` / `projects.owner_id`).

## Responses

- `201` — `{ "publish": { id, project_id, deployment_id, url, config_hash, bundle_path, status: "live", created_at }, "budgets": [{ metric, budget, actual, status }] }`
- `400` — invalid body, or budget exceeded:
  `{ "error": "Bundle exceeds size budgets", "detail": { "violations": [{ metric, budget, actual, status: "fail" }], "outcomes": [...] } }`
- `401` — missing/invalid JWT
- `403` — caller lacks owner/editor role
- `404` — project not found
- `500` — storage or DB failure

## Side effects

- Uploads `index.html` + `manifest.json` to `bundles` bucket at
  `{project_id}/{publish_id}/`. Manifest contains per-file sha256, byte size,
  role, plus `config_hash` (sha256 of canonical config JSON).
- Inserts `publishes` row with `status='live'`.

## Budgets (must match packages/build/src/budgets.ts)

| metric | budget | measurement |
|---|---|---|
| js-gz | 174080 (170 KiB) | gzip bytes across *.js/*.mjs |
| css-gz | 40960 (40 KiB) | gzip bytes across *.css |
| critical-assets | 1228800 (1.2 MiB) | raw bytes across role='asset' |

+10% warn tolerance; beyond → 400.

## Local mock harness

Edge functions run on Deno deploy; no local Supabase here. To smoke-test
locally:

```
deno serve --env-file=.env.local backend/functions/publish-pipeline/index.ts
# then stub SUPABASE_URL to a local supabase (`supabase start`) or a mock
# PostgREST/storage server. Assert:
#   - 401 without JWT
#   - 403 with a viewer's JWT
#   - 201 + bundles objects + publishes row with an editor JWT
#   - 400 with violations when config forces js-gz over budget
```

## Seam

`assembleBundle()` is the documented seam for the real `@lumen/build` Node
worker (see header comment in index.ts).

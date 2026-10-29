# asset-pipeline — request/response contract

## Request

```
POST /functions/v1/asset-pipeline
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json

# drain mode (empty body ok), or per-job mode:
{ "job_id": "<uuid>",
  "probe": { "duration_ms": 12000, "width": 1920, "height": 1080, "format": "mp4" },
  "variants": [
    { "label": "720p.mp4", "width": 1280, "height": 720, "bytes": 123456,
      "content_type": "video/mp4", "data_base64": "..." }
  ] }
```

Service-role key required (401 otherwise).

## Response

`200` — `{ "claimed": <n>, "jobs": [{ "job_id", "status": "done"|"failed", "error"? }] }`

Drains up to 5 queued jobs per invocation.

## Side effects per job

- `asset_jobs.status`: queued → running → done (progress 100, result.manifest_path) or failed (error set).
- Uploads variants + `manifest.json` to `assets` bucket at
  `{owner_id}/{project_id}/{asset_id}/`.
- `assets.status`: processing → done (manifest jsonb set) or failed (error set).

## Claim SQL

Preferred claim is `rpc('claim_asset_job')` — SQL provided in the header
comment of index.ts (`update ... where id = (select ... for update skip
locked) returning *`). Apply it as a migration; the function falls back to a
select+conditional-update loop when the RPC is absent.

## Transcode seam

ffmpeg cannot run on Supabase edge. Heavy transcode happens in an external
worker that POSTs probe/variant metadata per job to this endpoint (per-job
mode above). This endpoint owns queue bookkeeping, storage, and row updates.

## Local mock harness

`deno serve` the function with `SUPABASE_SERVICE_ROLE_KEY=test` pointed at a
mock PostgREST + storage server (or `supabase start`). Assert:

- 401 without the service key
- queued job → done, manifest.json uploaded, assets row updated
- job with a variant upload failure → job + asset both `failed` with error
- two concurrent invocations do not process the same job twice (skip locked)

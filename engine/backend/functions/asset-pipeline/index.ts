/**
 * asset-pipeline — worker endpoint. POST, service-role key only.
 *
 * Drains queued `asset_jobs` (one batch per invocation), marks each job
 * running → processes → done/failed, and updates the parent `assets` row.
 *
 * ── TRANSCODE SEAM ──────────────────────────────────────────────────────────
 * ffmpeg is NOT available on Supabase edge functions (Deno sandbox, no
 * subprocess). Heavy transcoding runs in an external worker that calls this
 * endpoint per job, passing probe/variant metadata it produced in
 * `payload.probe` / `payload.variants`. This function's job is queue
 * bookkeeping + manifest assembly + storage upload + assets row update.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Job claiming — preferred path is the SQL function below (apply as a
 * migration); the code falls back to a best-effort loop if the RPC is absent.
 *
 *   create or replace function claim_asset_job()
 *   returns setof asset_jobs language sql as $$
 *     update asset_jobs
 *        set status = 'running', updated_at = now()
 *      where id = (
 *        select id from asset_jobs
 *         where status = 'queued'
 *         order by created_at
 *         limit 1
 *         for update skip locked
 *      )
 *     returning *;
 *   $$;
 */

import { isPreflight, preflightResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { err, json } from '../_shared/responses.ts';
import { sha256Hex } from '../_shared/hash.ts';

interface AssetJob {
  id: string;
  asset_id: string;
  ops: string[];
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface Asset {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  kind: 'video' | 'image';
  status: 'pending' | 'processing' | 'done' | 'failed';
  manifest: Record<string, unknown> | null;
  error: string | null;
}

interface ProbeVariant {
  label: string;
  width?: number;
  height?: number;
  bytes: number;
  content_type: string;
  /** Base64-encoded bytes, or an external URL the external worker wrote to. */
  data_base64?: string;
  external_path?: string;
}

interface JobPayload {
  probe?: { duration_ms?: number; width?: number; height?: number; format?: string };
  variants?: ProbeVariant[];
}

const BATCH_LIMIT = 5;

import { AuthError, requireServiceRole } from '../_shared/auth.ts';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// deno-lint-ignore no-explicit-any
type Db = any;

async function claimJob(db: Db): Promise<AssetJob | null> {
  // Preferred: atomic claim via SQL (see header comment).
  const { data, error } = await db.rpc('claim_asset_job');
  if (!error) {
    const rows = (data ?? []) as AssetJob[];
    return rows.length > 0 ? rows[0] : null;
  }
  if (!/claim_asset_job/i.test(error.message)) {
    console.warn('claim_asset_job rpc error, falling back', error.message);
  }
  // Fallback loop: fetch one queued job and flip it to running. Race-safe
  // enough for low contention because the update filters on status='queued';
  // a concurrent claim makes the update match 0 rows and we retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: queued, error: selErr } = await db
      .from('asset_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1);
    if (selErr || !queued || queued.length === 0) return null;
    const job = queued[0] as AssetJob;
    const { data: claimed, error: updErr } = await db
      .from('asset_jobs')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select();
    if (!updErr && claimed && claimed.length > 0) return claimed[0] as AssetJob;
  }
  return null;
}

async function failJob(db: Db, job: AssetJob, message: string): Promise<void> {
  await db
    .from('asset_jobs')
    .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
    .eq('id', job.id);
  await db.from('assets').update({ status: 'failed', error: message }).eq('id', job.asset_id);
}

async function processJob(db: Db, job: AssetJob, payload: JobPayload): Promise<void> {
  const { data: asset, error: assetErr } = await db
    .from('assets')
    .select('*')
    .eq('id', job.asset_id)
    .single();
  if (assetErr || !asset) throw new Error(`assets row not found: ${assetErr?.message ?? job.asset_id}`);
  const a = asset as Asset;

  await db.from('assets').update({ status: 'processing' }).eq('id', a.id);

  // Build manifest from probe metadata supplied by the external worker.
  const variants = payload.variants ?? [];
  const manifest = {
    asset_id: a.id,
    ops: job.ops,
    probe: payload.probe ?? null,
    variants: [] as Array<Record<string, unknown>>,
    generated_at: new Date().toISOString(),
  };

  // assets bucket path convention per SCHEMA.md: {owner_id}/{project_id}/{asset_id}/...
  const prefix = `${a.owner_id}/${a.project_id}/${a.id}`;
  let uploaded = 0;
  for (const v of variants) {
    const path = `${prefix}/${v.label}`;
    if (v.data_base64) {
      const bytes = base64ToBytes(v.data_base64);
      const { error: upErr } = await db.storage
        .from('assets')
        .upload(path, bytes, { contentType: v.content_type, upsert: true });
      if (upErr) throw new Error(`variant upload failed (${v.label}): ${upErr.message}`);
      manifest.variants.push({ ...v, data_base64: undefined, path, sha256: await sha256Hex(bytes) });
    } else {
      // External worker already wrote the bytes; we only record the pointer.
      manifest.variants.push({ ...v, path: v.external_path ?? path });
    }
    uploaded++;
    await db
      .from('asset_jobs')
      .update({ progress: Math.round((uploaded / Math.max(variants.length, 1)) * 90) })
      .eq('id', job.id);
  }

  const manifestPath = `${prefix}/manifest.json`;
  const { error: manErr } = await db.storage
    .from('assets')
    .upload(manifestPath, JSON.stringify(manifest, null, 2), {
      contentType: 'application/json',
      upsert: true,
    });
  if (manErr) throw new Error(`manifest upload failed: ${manErr.message}`);

  const now = new Date().toISOString();
  await db
    .from('asset_jobs')
    .update({ status: 'done', progress: 100, result: { manifest_path: manifestPath }, updated_at: now })
    .eq('id', job.id);
  await db.from('assets').update({ status: 'done', manifest, error: null }).eq('id', a.id);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (isPreflight(req)) return preflightResponse(req);
  if (req.method !== 'POST') return err(req, 405, 'Method not allowed');

  try {
    requireServiceRole(req);
  } catch {
    return err(req, 401, 'Service role key required');
  }

  const db = serviceClient();

  // Optional per-invocation payload (external worker mode): if the body names
  // a specific job_id, its payload.probe / payload.variants are used.
  let payloadByJob: Record<string, JobPayload> = {};
  try {
    const body = await req.json();
    if (body && typeof body === 'object') {
      const b = body as { job_id?: string; probe?: JobPayload['probe']; variants?: JobPayload['variants'] };
      if (b.job_id) payloadByJob[b.job_id] = { probe: b.probe, variants: b.variants };
    }
  } catch {
    /* empty body is fine — pure drain mode */
  }

  const processed: Array<{ job_id: string; status: 'done' | 'failed'; error?: string }> = [];
  for (let i = 0; i < BATCH_LIMIT; i++) {
    const job = await claimJob(db);
    if (!job) break;
    try {
      await processJob(db, job, payloadByJob[job.id] ?? {});
      processed.push({ job_id: job.id, status: 'done' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await failJob(db, job, message);
      processed.push({ job_id: job.id, status: 'failed', error: message });
    }
  }

  return json(req, { claimed: processed.length, jobs: processed });
});

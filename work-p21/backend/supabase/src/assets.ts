/**
 * HostedAssetQueue — mirrors the @lumen/app-assets enqueue/progress surface
 * against `assets` + `asset_jobs` tables and the `assets` storage bucket.
 *
 * Flow (SCHEMA.md): enqueue inserts an assets row (status 'pending') +
 * asset_jobs row (status 'queued') and uploads the source file to
 * `assets/{owner_id}/{project_id}/{asset_id}/...`. The `asset-pipeline`
 * edge worker drains the queue; clients subscribe to postgres_changes on
 * asset_jobs for live progress and read the manifest back from assets.
 */
import type { SupabaseClientLike } from './client.js';
import { unwrap, unwrapRows } from './client.js';

export type HostedAssetKind = 'video' | 'image';
export type HostedAssetStatus = 'pending' | 'processing' | 'done' | 'failed';
export type HostedAssetJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface HostedAsset {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  kind: HostedAssetKind;
  status: HostedAssetStatus;
  manifest?: unknown;
  error?: string;
  createdAt: string;
}

export interface HostedAssetJob {
  id: string;
  assetId: string;
  ops: string[];
  status: HostedAssetJobStatus;
  progress: number;
  result?: unknown;
  error?: string;
}

export interface EnqueueAssetInput {
  projectId: string;
  name: string;
  kind: HostedAssetKind;
  ops: string[];
  /** File body uploaded to the assets bucket (Blob/ArrayBuffer/Uint8Array). */
  file?: unknown;
  contentType?: string;
}

interface AssetRow {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  kind: HostedAssetKind;
  status: HostedAssetStatus;
  manifest: unknown;
  error: string | null;
  created_at: string;
}

interface AssetJobRow {
  id: string;
  asset_id: string;
  ops: string[];
  status: HostedAssetJobStatus;
  progress: number;
  result: unknown;
  error: string | null;
}

export function toHostedAsset(row: AssetRow): HostedAsset {
  const asset: HostedAsset = {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.manifest !== null && row.manifest !== undefined) asset.manifest = row.manifest;
  if (row.error !== null) asset.error = row.error;
  return asset;
}

function toHostedJob(row: AssetJobRow): HostedAssetJob {
  const job: HostedAssetJob = {
    id: row.id,
    assetId: row.asset_id,
    ops: row.ops,
    status: row.status,
    progress: row.progress,
  };
  if (row.result !== null && row.result !== undefined) job.result = row.result;
  if (row.error !== null) job.error = row.error;
  return job;
}

export type AssetJobEventCallback = (job: HostedAssetJob) => void;

export interface HostedAssetQueueOptions {
  userId?: () => Promise<string | undefined>;
}

export class HostedAssetQueue {
  private readonly client: SupabaseClientLike;
  private readonly resolveUserId: () => Promise<string | undefined>;

  constructor(client: SupabaseClientLike, options: HostedAssetQueueOptions = {}) {
    this.client = client;
    this.resolveUserId =
      options.userId ??
      (async () => (await this.client.auth.getUser()).data?.id ?? undefined);
  }

  /**
   * Enqueue: assets row → asset_jobs row → storage upload to the private
   * `assets` bucket at `{owner_id}/{project_id}/{asset_id}/source`.
   */
  async enqueue(input: EnqueueAssetInput): Promise<{ asset: HostedAsset; job: HostedAssetJob }> {
    const ownerId = (await this.resolveUserId()) ?? undefined;
    if (!ownerId) throw new Error('assets.enqueue: no authenticated user');
    const assetRow = await unwrap<AssetRow>(
      this.client
        .from('assets')
        .insert({
          project_id: input.projectId,
          owner_id: ownerId,
          name: input.name,
          kind: input.kind,
        })
        .select()
        .single(),
      'assets.enqueue.asset',
    );
    const jobRow = await unwrap<AssetJobRow>(
      this.client
        .from('asset_jobs')
        .insert({ asset_id: assetRow.id, ops: input.ops })
        .select()
        .single(),
      'assets.enqueue.job',
    );
    if (input.file !== undefined) {
      const path = `${ownerId}/${input.projectId}/${assetRow.id}/source`;
      const { error } = await this.client.storage.from('assets').upload(path, input.file, {
        ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
      });
      if (error) throw new Error(`assets.enqueue.upload: ${error.message}`);
    }
    return { asset: toHostedAsset(assetRow), job: toHostedJob(jobRow) };
  }

  async getAsset(id: string): Promise<HostedAsset | undefined> {
    const { data, error } = await this.client
      .from('assets')
      .select()
      .eq('id', id)
      .single();
    if (error) return undefined;
    return data ? toHostedAsset(data as AssetRow) : undefined;
  }

  async listAssets(projectId: string): Promise<HostedAsset[]> {
    const rows = await unwrapRows<AssetRow>(
      this.client
        .from('assets')
        .select()
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      'assets.list',
    );
    return rows.map(toHostedAsset);
  }

  /** Read the processed manifest back from the assets row (undefined until done). */
  async getManifest(assetId: string): Promise<unknown> {
    const asset = await this.getAsset(assetId);
    return asset?.manifest;
  }

  /**
   * Subscribe to postgres_changes on asset_jobs for live status/progress.
   * Returns an unsubscribe function.
   */
  subscribeToJobStatus(assetId: string, callback: AssetJobEventCallback): () => void {
    const channel = this.client
      .channel(`asset_jobs:${assetId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'asset_jobs', filter: `asset_id=eq.${assetId}` },
        (payload) => {
          const row = (payload as { new?: AssetJobRow }).new;
          if (row) callback(toHostedJob(row));
        },
      )
      .subscribe();
    return () => {
      void channel.unsubscribe();
    };
  }
}

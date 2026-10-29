/**
 * HostedPublishService — mirrors @lumen/app-publish PublishService.
 *
 * publish() invokes the `publish-pipeline` edge function
 * (POST {project_id, config}) which builds the bundle, stores it in the
 * `bundles` bucket and writes the `publishes` row (service role). History
 * reads come from the `publishes` table. Rollback re-invokes the edge
 * function with the prior publish's config_hash as the snapshot reference.
 */
import type { SupabaseClientLike } from './client.js';
import { unwrapRows } from './client.js';

export type HostedPublishStatus = 'live' | 'rolled-back';

export interface HostedPublishRecord {
  id: string;
  projectId: string;
  deploymentId: string;
  url: string;
  configHash: string;
  bundlePath: string;
  status: HostedPublishStatus;
  createdAt: string;
}

export interface HostedPublishResult {
  record: HostedPublishRecord;
  url: string;
}

interface PublishRow {
  id: string;
  project_id: string;
  deployment_id: string;
  url: string;
  config_hash: string;
  bundle_path: string;
  status: HostedPublishStatus;
  created_at: string;
}

export function toHostedPublish(row: PublishRow): HostedPublishRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    deploymentId: row.deployment_id,
    url: row.url,
    configHash: row.config_hash,
    bundlePath: row.bundle_path,
    status: row.status,
    createdAt: row.created_at,
  };
}

export class HostedPublishService {
  private readonly client: SupabaseClientLike;

  constructor(client: SupabaseClientLike) {
    this.client = client;
  }

  /** Invoke the publish-pipeline edge function; returns the new publish row. */
  async publish(projectId: string, config: unknown): Promise<HostedPublishResult> {
    const { data, error } = await this.client.functions.invoke('publish-pipeline', {
      body: { project_id: projectId, config },
    });
    if (error) throw new Error(`publish: ${error.message}`);
    const payload = data as { publish?: PublishRow; url?: string } | null;
    if (!payload?.publish) throw new Error('publish: malformed publish-pipeline response');
    const record = toHostedPublish(payload.publish);
    return { record, url: payload.url ?? record.url };
  }

  async listHistory(projectId: string): Promise<HostedPublishRecord[]> {
    const rows = await unwrapRows<PublishRow>(
      this.client
        .from('publishes')
        .select()
        .eq('project_id', projectId)
        .order('created_at', { ascending: true }),
      'publish.listHistory',
    );
    return rows.map(toHostedPublish);
  }

  /**
   * Rollback: re-invoke the pipeline pinned to the earlier publish's
   * config_hash snapshot so the redeployed bundle is bit-identical.
   */
  async rollback(projectId: string, publishRecordId: string): Promise<HostedPublishResult> {
    const history = await this.listHistory(projectId);
    const target = history.find((r) => r.id === publishRecordId);
    if (!target) {
      throw new Error(`rollback: publish record not found: ${publishRecordId}`);
    }
    const { data, error } = await this.client.functions.invoke('publish-pipeline', {
      body: {
        project_id: projectId,
        rollback_to: { publish_id: target.id, config_hash: target.configHash },
      },
    });
    if (error) throw new Error(`rollback: ${error.message}`);
    const payload = data as { publish?: PublishRow; url?: string } | null;
    if (!payload?.publish) throw new Error('rollback: malformed publish-pipeline response');
    const record = toHostedPublish(payload.publish);
    return { record, url: payload.url ?? record.url };
  }
}

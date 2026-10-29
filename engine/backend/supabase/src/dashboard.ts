/**
 * HostedDashboard — mirrors @lumen/app-dashboard's overview/listProjects/
 * publishHistory surface, reading `projects`/`publishes` directly and
 * recording self-reported analytics into `analytics_events` (per SCHEMA.md
 * these are self-reported publish-view events, never real traffic).
 */
import type { SupabaseClientLike } from './client.js';
import { unwrapRows } from './client.js';
import { toHostedPublish, type HostedPublishRecord } from './publish.js';

interface DashProjectRow {
  id: string;
  name: string;
  updated_at: string;
}

interface DashPublishRow {
  id: string;
  project_id: string;
  deployment_id: string;
  url: string;
  config_hash: string;
  bundle_path: string;
  status: 'live' | 'rolled-back';
  created_at: string;
}

export interface HostedDashboardProject {
  id: string;
  name: string;
  updatedAt: string;
  publishCount: number;
  latestPublish: HostedPublishRecord | undefined;
  publishStatus: 'never-published' | HostedPublishRecord['status'];
  liveUrl: string | undefined;
}

export interface HostedDashboardOverview {
  projectCount: number;
  liveCount: number;
  totalPublishes: number;
  /** Epoch ms of the most recent publish across all projects (0 = none). */
  lastPublishAt: number;
}

export interface HostedAnalyticsStats {
  totalViews: number;
  byProject: Record<string, number>;
  bySource: Record<string, number>;
}

export class HostedDashboard {
  private readonly client: SupabaseClientLike;

  constructor(client: SupabaseClientLike) {
    this.client = client;
  }

  async listProjects(): Promise<HostedDashboardProject[]> {
    const projects = await unwrapRows<DashProjectRow>(
      this.client.from('projects').select().order('updated_at', { ascending: false }),
      'dashboard.listProjects',
    );
    return Promise.all(
      projects.map(async (p) => {
        const history = await this.publishHistory(p.id);
        const latestPublish = history[history.length - 1];
        return {
          id: p.id,
          name: p.name,
          updatedAt: p.updated_at,
          publishCount: history.length,
          latestPublish,
          publishStatus: latestPublish ? latestPublish.status : 'never-published',
          liveUrl: latestPublish?.url,
        } satisfies HostedDashboardProject;
      }),
    );
  }

  async overview(): Promise<HostedDashboardOverview> {
    const projects = await this.listProjects();
    let liveCount = 0;
    let totalPublishes = 0;
    let lastPublishAt = 0;
    for (const p of projects) {
      totalPublishes += p.publishCount;
      if (p.publishStatus === 'live') liveCount++;
      if (p.latestPublish) {
        lastPublishAt = Math.max(lastPublishAt, Date.parse(p.latestPublish.createdAt));
      }
    }
    return { projectCount: projects.length, liveCount, totalPublishes, lastPublishAt };
  }

  async publishHistory(projectId: string): Promise<HostedPublishRecord[]> {
    const rows = await unwrapRows<DashPublishRow>(
      this.client
        .from('publishes')
        .select()
        .eq('project_id', projectId)
        .order('created_at', { ascending: true }),
      'dashboard.publishHistory',
    );
    return rows.map(toHostedPublish);
  }

  /** Record a self-reported publish-view analytics event. */
  async recordView(projectId: string, source = 'dashboard'): Promise<void> {
    await unwrapRows(
      this.client
        .from('analytics_events')
        .insert({ project_id: projectId, event: 'publish.view', source })
        .select(),
      'dashboard.recordView',
    );
  }

  async stats(projectId: string): Promise<HostedAnalyticsStats> {
    const rows = await unwrapRows<{ project_id: string; event: string; source: string }>(
      this.client
        .from('analytics_events')
        .select()
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      'dashboard.stats',
    );
    const byProject: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const row of rows) {
      byProject[row.project_id] = (byProject[row.project_id] ?? 0) + 1;
      bySource[row.source] = (bySource[row.source] ?? 0) + 1;
    }
    return { totalViews: rows.length, byProject, bySource };
  }
}

/**
 * @lumen/app-dashboard — DashboardService.
 *
 * Aggregation layer for the hosted publishing dashboard. Reads projects
 * through the ProjectStore seam and publish data through the
 * PublishService seam, enriching each project with its latest publish
 * status and version count. `publishHistory()` and `rollback()` are thin
 * delegations to PublishService so the dashboard never forks publish
 * semantics.
 */

import type { PublishRecord } from '@lumen/app-publish';

/** Minimal project read seam (satisfied by @lumen/app-projects ProjectStore). */
export interface DashboardProjectStore {
  listProjects(): Promise<{ id: string; name: string; updatedAt: string }[]>;
  listVersions(projectId: string): Promise<unknown[]>;
}

/** Minimal publish seam (satisfied by @lumen/app-publish PublishService). */
export interface DashboardPublishService {
  listHistory(projectId: string): PublishRecord[];
  rollback(projectId: string, publishRecordId: string): Promise<PublishRecord>;
}

/** A project enriched with publish status for the dashboard list view. */
export interface DashboardProject {
  id: string;
  name: string;
  updatedAt: string;
  /** Number of stored versions in ProjectStore history. */
  versionCount: number;
  /** Total publishes on record. */
  publishCount: number;
  /** Latest publish record, if any. */
  latestPublish: PublishRecord | undefined;
  /** Derived status: 'never-published' | status of the latest publish. */
  publishStatus: 'never-published' | PublishRecord['status'];
  /** Live URL of the latest publish (undefined when never published). */
  liveUrl: string | undefined;
}

export interface DashboardOverview {
  projectCount: number;
  /** Projects whose latest publish is 'live'. */
  liveCount: number;
  /** Total publish records across all projects. */
  totalPublishes: number;
  /** Epoch ms of the most recent publish across all projects (0 = none). */
  lastPublishAt: number;
}

export interface DashboardServiceOptions {
  projects: DashboardProjectStore;
  publish: DashboardPublishService;
}

export class DashboardService {
  readonly #projects: DashboardProjectStore;
  readonly #publish: DashboardPublishService;

  constructor(options: DashboardServiceOptions) {
    this.#projects = options.projects;
    this.#publish = options.publish;
  }

  /** All projects enriched with latest publish status + version count. */
  async listProjects(): Promise<DashboardProject[]> {
    const projects = await this.#projects.listProjects();
    const enriched = await Promise.all(
      projects.map(async (p): Promise<DashboardProject> => {
        const [versions, history] = await Promise.all([
          this.#projects.listVersions(p.id),
          Promise.resolve().then(() => this.#publish.listHistory(p.id)),
        ]);
        const latestPublish = history[history.length - 1];
        return {
          id: p.id,
          name: p.name,
          updatedAt: p.updatedAt,
          versionCount: versions.length,
          publishCount: history.length,
          latestPublish,
          publishStatus: latestPublish ? latestPublish.status : 'never-published',
          liveUrl: latestPublish?.url,
        };
      }),
    );
    return enriched;
  }

  /** Publish history for a project (delegates to PublishService). */
  publishHistory(projectId: string): PublishRecord[] {
    return this.#publish.listHistory(projectId);
  }

  /** Roll back a project to a prior publish (delegates to PublishService). */
  async rollback(projectId: string, recordId: string): Promise<PublishRecord> {
    return this.#publish.rollback(projectId, recordId);
  }

  /** Fleet-wide overview counters. */
  async overview(): Promise<DashboardOverview> {
    const projects = await this.listProjects();
    let totalPublishes = 0;
    let lastPublishAt = 0;
    let liveCount = 0;
    for (const p of projects) {
      totalPublishes += p.publishCount;
      if (p.publishStatus === 'live') liveCount++;
      const at = p.latestPublish?.publishedAt ?? 0;
      if (at > lastPublishAt) lastPublishAt = at;
    }
    return {
      projectCount: projects.length,
      liveCount,
      totalPublishes,
      lastPublishAt,
    };
  }
}

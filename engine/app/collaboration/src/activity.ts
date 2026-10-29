import type { ActivityEntry } from './types.js';

export const ACTIVITY_LOG_CAP = 200;

export interface ActivityLogOptions {
  /** Injectable clock returning epoch millis (for tests). */
  now?: () => number;
  /** Ring-buffer capacity per project (default 200). */
  cap?: number;
}

export interface ActivityFilter {
  /** Epoch-millis lower bound (inclusive). */
  since?: number;
  /** Only entries by this actor. */
  actor?: string;
}

/**
 * ActivityLog — local-only, per-project ring buffer of collaboration events
 * (shares, edits, invites, accepts, ...). Capped per project; oldest entries
 * drop off first.
 */
export class ActivityLog {
  private readonly now: () => number;
  private readonly cap: number;
  private readonly byProject = new Map<string, ActivityEntry[]>();

  constructor(options: ActivityLogOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.cap = options.cap ?? ACTIVITY_LOG_CAP;
  }

  append(
    projectId: string,
    entry: { actorId: string; action: string; detail?: string },
  ): ActivityEntry {
    const list = this.byProject.get(projectId) ?? [];
    const full: ActivityEntry = {
      projectId,
      actorId: entry.actorId,
      action: entry.action,
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
      at: this.now(),
    };
    list.push(full);
    if (list.length > this.cap) list.splice(0, list.length - this.cap);
    this.byProject.set(projectId, list);
    return { ...full };
  }

  /** Entries for a project, oldest first, filtered by `since`/`actor`. */
  list(projectId: string, filter: ActivityFilter = {}): ActivityEntry[] {
    return (this.byProject.get(projectId) ?? [])
      .filter((e) => filter.since === undefined || e.at >= filter.since)
      .filter((e) => filter.actor === undefined || e.actorId === filter.actor)
      .map((e) => ({ ...e }));
  }
}

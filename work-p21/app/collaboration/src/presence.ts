import type { PresenceEntry } from './types.js';

export interface PresenceTrackerOptions {
  /** Injectable clock returning epoch millis (for tests). */
  now?: () => number;
}

/**
 * PresenceTracker — local-only heartbeat table. No sockets, no broadcast:
 * callers heartbeat on an interval and read `activeUsers` to render cursors.
 */
export class PresenceTracker {
  private readonly now: () => number;
  private readonly entries = new Map<string, PresenceEntry>();

  constructor(options: PresenceTrackerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  private key(userId: string, projectId: string): string {
    return `${projectId}::${userId}`;
  }

  /** Record a heartbeat, optionally updating the user's cursor position. */
  heartbeat(userId: string, projectId: string, cursor?: string): void {
    const key = this.key(userId, projectId);
    const existing = this.entries.get(key);
    const entry: PresenceEntry = {
      userId,
      projectId,
      lastSeenAt: this.now(),
      ...(cursor !== undefined ? { cursor } : existing?.cursor !== undefined ? { cursor: existing.cursor } : {}),
    };
    this.entries.set(key, entry);
  }

  /** Remove a user's presence from a project (e.g. on tab close). */
  leave(userId: string, projectId: string): boolean {
    return this.entries.delete(this.key(userId, projectId));
  }

  /**
   * Active users for a project within `withinMs` (default 30s). Stale
   * entries are pruned as a side effect of reading.
   */
  activeUsers(projectId: string, withinMs = 30_000): PresenceEntry[] {
    const cutoff = this.now() - withinMs;
    const active: PresenceEntry[] = [];
    for (const [key, entry] of this.entries) {
      if (entry.lastSeenAt < cutoff) {
        this.entries.delete(key);
        continue;
      }
      if (entry.projectId === projectId) active.push({ ...entry });
    }
    return active;
  }
}

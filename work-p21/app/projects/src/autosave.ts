import type { ProjectStore } from './store.js';
import type { ProjectConfig } from './types.js';

export interface AutosaveTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface AutosaveManagerOptions {
  /** Debounce window in ms (default 500). */
  debounceMs?: number;
  /** Injectable timer pair for tests (defaults to global timers). */
  timers?: AutosaveTimers;
  /** Optional label applied to autosaved versions. */
  label?: string;
  /** Error hook; defaults to rethrowing asynchronously. */
  onError?: (err: unknown) => void;
}

interface PendingSave {
  config: ProjectConfig;
  handle: unknown;
}

/**
 * AutosaveManager — debounced config saves for open projects.
 *
 * Call schedule() on every edit; only the last edit within the debounce
 * window is persisted (as a store updateProject, which appends a version).
 * flush() forces immediate persistence of all pending saves.
 */
export class AutosaveManager {
  private readonly store: ProjectStore;
  private readonly debounceMs: number;
  private readonly timers: AutosaveTimers;
  private readonly label: string;
  private readonly onError: (err: unknown) => void;
  private readonly pending = new Map<string, PendingSave>();

  constructor(store: ProjectStore, options: AutosaveManagerOptions = {}) {
    this.store = store;
    this.debounceMs = options.debounceMs ?? 500;
    this.timers = options.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as Parameters<typeof clearTimeout>[0]),
    };
    this.label = options.label ?? 'autosave';
    this.onError =
      options.onError ??
      ((err) => {
        setTimeout(() => {
          throw err;
        }, 0);
      });
  }

  /** True when a debounced save for this project is still waiting. */
  isPending(projectId: string): boolean {
    return this.pending.has(projectId);
  }

  /** Debounced save of the project's config. */
  schedule(projectId: string, config: ProjectConfig): void {
    const prev = this.pending.get(projectId);
    if (prev) this.timers.clearTimeout(prev.handle);
    const handle = this.timers.setTimeout(() => {
      void this.saveNow(projectId);
    }, this.debounceMs);
    this.pending.set(projectId, { config, handle });
  }

  /** Persist immediately, cancelling any pending debounce timer. */
  async saveNow(projectId: string): Promise<void> {
    const entry = this.pending.get(projectId);
    if (!entry) return;
    this.timers.clearTimeout(entry.handle);
    this.pending.delete(projectId);
    try {
      await this.store.updateProject(projectId, { config: entry.config }, this.label);
    } catch (err) {
      this.onError(err);
    }
  }

  /** Flush all pending saves immediately. */
  async flush(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((id) => this.saveNow(id)));
  }

  /** Discard pending saves without persisting. */
  cancel(projectId?: string): void {
    if (projectId === undefined) {
      for (const entry of this.pending.values()) this.timers.clearTimeout(entry.handle);
      this.pending.clear();
    } else {
      const entry = this.pending.get(projectId);
      if (entry) {
        this.timers.clearTimeout(entry.handle);
        this.pending.delete(projectId);
      }
    }
  }
}

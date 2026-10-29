/**
 * @lumen/app-dashboard — local-only publish-view analytics.
 *
 * Records "publish-view" events (a viewer looked at a published site)
 * locally — Memory + LocalStorage adapters, capped per project. There are
 * ZERO network calls in this module: this is self-reported / local
 * telemetry suitable for a builder dashboard preview, NOT real traffic
 * measurement. Counts only reflect what this client has been told to
 * record.
 */

/** One publish-view event. */
export interface PublishViewEvent {
  projectId: string;
  /** Unix epoch milliseconds. */
  ts: number;
  /** Optional free-form source hint (e.g. 'share-link', 'dashboard'). */
  source?: string;
}

/** Max events retained per project (ring buffer, oldest evicted first). */
export const ANALYTICS_CAP = 1000;

/** Persistence seam for view events. Local-only implementations. */
export interface AnalyticsStorage {
  append(event: PublishViewEvent): void;
  list(projectId: string): PublishViewEvent[];
  all(): PublishViewEvent[];
  clear(): void;
}

/** In-memory analytics storage (default). Enforces the per-project cap. */
export class MemoryAnalyticsStorage implements AnalyticsStorage {
  #events = new Map<string, PublishViewEvent[]>(); // projectId → events (oldest first)

  append(event: PublishViewEvent): void {
    const list = this.#events.get(event.projectId) ?? [];
    list.push({ ...event });
    while (list.length > ANALYTICS_CAP) list.shift(); // prune oldest
    this.#events.set(event.projectId, list);
  }

  list(projectId: string): PublishViewEvent[] {
    return (this.#events.get(projectId) ?? []).map((e) => ({ ...e }));
  }

  all(): PublishViewEvent[] {
    return [...this.#events.values()].flat().map((e) => ({ ...e }));
  }

  clear(): void {
    this.#events.clear();
  }
}

export const LOCALSTORAGE_ANALYTICS_KEY = 'lumen.dashboard.analytics.v1';

/** LocalStorage-backed analytics storage (browser); throws under Node when used. */
export class LocalStorageAnalyticsStorage implements AnalyticsStorage {
  #key: string;

  constructor(key: string = LOCALSTORAGE_ANALYTICS_KEY) {
    this.#key = key;
  }

  #storage(): Storage {
    if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
      throw new Error('LocalStorageAnalyticsStorage: localStorage unavailable (non-browser)');
    }
    return globalThis.localStorage;
  }

  #read(): Record<string, PublishViewEvent[]> {
    const raw = this.#storage().getItem(this.#key);
    if (!raw) return {};
    return (JSON.parse(raw) as Record<string, PublishViewEvent[]>) ?? {};
  }

  #write(payload: Record<string, PublishViewEvent[]>): void {
    this.#storage().setItem(this.#key, JSON.stringify(payload));
  }

  append(event: PublishViewEvent): void {
    const payload = this.#read();
    const list = (payload[event.projectId] ??= []);
    list.push(event);
    while (list.length > ANALYTICS_CAP) list.shift();
    this.#write(payload);
  }

  list(projectId: string): PublishViewEvent[] {
    return [...(this.#read()[projectId] ?? [])];
  }

  all(): PublishViewEvent[] {
    return Object.values(this.#read()).flat();
  }

  clear(): void {
    this.#storage().removeItem(this.#key);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC calendar day key ('YYYY-MM-DD') for an epoch-ms timestamp. */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Epoch ms at UTC midnight for the day containing `ts`. */
export function dayStart(ts: number): number {
  return Date.parse(dayKey(ts));
}

export interface AnalyticsStatsQuery {
  /** Window length in days (inclusive, ending today). Default: 7. */
  days?: number;
}

export interface AnalyticsDayBucket {
  /** UTC day key 'YYYY-MM-DD'. */
  day: string;
  views: number;
}

export interface AnalyticsStats {
  projectId: string;
  /** Window length in days actually used. */
  days: number;
  /** Total views within the window. */
  views: number;
  /** Number of distinct UTC days with ≥1 view within the window. */
  uniqueDays: number;
  /** Per-day buckets covering the full window, oldest first. */
  viewsByDay: AnalyticsDayBucket[];
}

export interface TopProjectEntry {
  projectId: string;
  views: number;
}

export interface AnalyticsStoreOptions {
  storage?: AnalyticsStorage;
  /** Injectable clock returning epoch millis (for tests). */
  now?: () => number;
}

/**
 * AnalyticsStore — records publish-view events and aggregates stats.
 * LOCAL ONLY: nothing here ever leaves the device; numbers are
 * self-reported telemetry, not verified traffic.
 */
export class AnalyticsStore {
  readonly #storage: AnalyticsStorage;
  readonly #now: () => number;

  constructor(options: AnalyticsStoreOptions = {}) {
    this.#storage = options.storage ?? new MemoryAnalyticsStorage();
    this.#now = options.now ?? (() => Date.now());
  }

  /** Record a publish-view event (ts defaults to now). */
  recordView(projectId: string, event: { ts?: number; source?: string } = {}): PublishViewEvent {
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('recordView: projectId is required');
    }
    const recorded: PublishViewEvent = {
      projectId,
      ts: event.ts ?? this.#now(),
      ...(event.source !== undefined ? { source: event.source } : {}),
    };
    this.#storage.append(recorded);
    return { ...recorded };
  }

  /** Raw events for a project, oldest first. */
  listViews(projectId: string): PublishViewEvent[] {
    return this.#storage.list(projectId);
  }

  /**
   * Aggregate stats over the trailing `days`-long window (default 7),
   * inclusive of today, bucketed by UTC day.
   */
  stats(projectId: string, query: AnalyticsStatsQuery = {}): AnalyticsStats {
    const days = Math.max(1, Math.floor(query.days ?? 7));
    const todayStart = dayStart(this.#now());
    const windowStart = todayStart - (days - 1) * DAY_MS;
    const windowEnd = todayStart + DAY_MS; // exclusive

    const counts = new Map<string, number>();
    let views = 0;
    for (const event of this.#storage.list(projectId)) {
      if (event.ts < windowStart || event.ts >= windowEnd) continue;
      views++;
      const key = dayKey(event.ts);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const viewsByDay: AnalyticsDayBucket[] = [];
    for (let i = 0; i < days; i++) {
      const day = dayKey(windowStart + i * DAY_MS);
      viewsByDay.push({ day, views: counts.get(day) ?? 0 });
    }

    return {
      projectId,
      days,
      views,
      uniqueDays: counts.size,
      viewsByDay,
    };
  }

  /**
   * Projects ranked by total recorded views (all time), descending.
   * Ties broken by projectId for determinism.
   */
  topProjects(limit = 10): TopProjectEntry[] {
    const totals = new Map<string, number>();
    for (const event of this.#storage.all()) {
      totals.set(event.projectId, (totals.get(event.projectId) ?? 0) + 1);
    }
    return [...totals.entries()]
      .map(([projectId, views]) => ({ projectId, views }))
      .sort((a, b) => b.views - a.views || (a.projectId < b.projectId ? -1 : 1))
      .slice(0, Math.max(0, Math.floor(limit)));
  }
}

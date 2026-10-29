/**
 * Preload strategy executor.
 *
 * Runs manifest entries through a priority queue (critical → eager → lazy)
 * with a concurrency-limited worker pool (default 4), abort support, and
 * progress aggregation. Progress is reported through an injected `emit`
 * callback carrying the frozen `asset:progress` payload shape
 * (`{ loaded, total, assetId? }`), keeping this module kernel-agnostic.
 */
import type { AssetEntry, AssetManifest, PreloadStrategy } from '@lumen/contracts';
import { groupByPriority } from './manifest.js';
import { loadAsset, type AssetHandle, type LoadOptions } from './loader.js';

/** Frozen `asset:progress` event payload (see @lumen/contracts kernel.ts). */
export interface AssetProgressPayload {
  loaded: number;
  total: number;
  assetId?: string;
}

export type ProgressEmitter = (payload: AssetProgressPayload) => void;

export interface PreloadResult {
  id: string;
  status: 'ready' | 'error';
  handle?: AssetHandle;
  error?: Error;
}

export interface PreloadOptions extends Omit<LoadOptions, 'onState'> {
  /** Max concurrent loads (default 4). */
  concurrency?: number;
  /** Abort the whole run; in-flight loads receive the signal. */
  signal?: AbortSignal;
  /** Kernel-agnostic progress sink (e.g. kernel bus emit bound to 'asset:progress'). */
  emit?: ProgressEmitter;
  /** Internal per-asset completion hook (used by AssetManager to track states). */
  onResult?: (result: PreloadResult) => void;
  /** P4: optional pause gate; while paused no new fetches are dequeued. */
  pauser?: PreloadPauser;
}

const PRIORITY_RANK: Record<PreloadStrategy, number> = { critical: 0, eager: 1, lazy: 2 };

/**
 * Deterministic priority queue over manifest entries. Higher-priority
 * entries dequeue first; ties break by id for reproducible order.
 */
export class AssetPriorityQueue {
  private readonly items: { id: string; entry: AssetEntry }[] = [];

  constructor(entries?: Iterable<[string, AssetEntry]>) {
    if (entries) for (const [id, entry] of entries) this.push(id, entry);
  }

  get size(): number {
    return this.items.length;
  }

  push(id: string, entry: AssetEntry): void {
    this.items.push({ id, entry });
    this.items.sort(
      (a, b) =>
        PRIORITY_RANK[a.entry.preload] - PRIORITY_RANK[b.entry.preload] ||
        a.id.localeCompare(b.id),
    );
  }

  /** Remove and return the highest-priority { id, entry }, or undefined. */
  shift(): { id: string; entry: AssetEntry } | undefined {
    return this.items.shift();
  }

  peek(): { id: string; entry: AssetEntry } | undefined {
    return this.items[0];
  }

  clear(): void {
    this.items.length = 0;
  }
}

/**
 * P4: cooperative pause gate for preload runs. While paused no new fetches
 * are dequeued; in-flight fetches continue (aborting wastes bytes).
 */
export class PreloadPauser {
  private paused = false;
  private waiters: Array<() => void> = [];

  get isPaused(): boolean {
    return this.paused;
  }

  setPaused(on: boolean): void {
    if (this.paused === on) return;
    this.paused = on;
    if (!on) {
      const waiters = this.waiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }

  /** Resolves immediately when unpaused; otherwise once resumed. */
  waitWhilePaused(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

/** Build a queue from a manifest, optionally restricted to a subset of ids. */
export function buildQueue(manifest: AssetManifest, ids?: readonly string[]): AssetPriorityQueue {
  const queue = new AssetPriorityQueue();
  const wanted = ids ? new Set(ids) : null;
  for (const list of Object.values(groupByPriority(manifest))) {
    for (const id of list) {
      if (wanted && !wanted.has(id)) continue;
      const entry = manifest.assets[id];
      if (entry) queue.push(id, entry);
    }
  }
  return queue;
}

/**
 * Execute a preload run over `queue`. Resolves with per-asset results once
 * the queue drains or the signal aborts (aborted runs resolve with the
 * results collected so far; unfinished entries are marked 'error' with an
 * AbortError). Individual asset failures never reject the run.
 */
export async function preload(
  queue: AssetPriorityQueue,
  options: PreloadOptions = {},
): Promise<PreloadResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const emit: ProgressEmitter = options.emit ?? ((): void => undefined);
  const total = queue.size;
  let loaded = 0;
  const results: PreloadResult[] = [];
  const resultById = new Map<string, PreloadResult>();

  emit({ loaded: 0, total });

  const loadOpts: LoadOptions = {};
  if (options.cdnBase) loadOpts.cdnBase = options.cdnBase;
  if (options.signal) loadOpts.signal = options.signal;
  if (options.fetchImpl) loadOpts.fetchImpl = options.fetchImpl;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted) return;
      if (options.pauser) await options.pauser.waitWhilePaused();
      if (options.signal?.aborted) return;
      const next = queue.shift();
      if (!next) return;
      const { id, entry } = next;
      try {
        const handle = await loadAsset(entry, loadOpts);
        const result: PreloadResult = { id, status: 'ready', handle };
        results.push(result);
        resultById.set(id, result);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        const result: PreloadResult = { id, status: 'error', error };
        results.push(result);
        resultById.set(id, result);
      }
      loaded += 1;
      options.onResult?.(results[results.length - 1] as PreloadResult);
      emit({ loaded, total, assetId: id });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(total, 1)) }, worker));

  // Mark entries that never ran (abort) as aborted errors.
  if (options.signal?.aborted) {
    const abortError = new DOMException('preload aborted', 'AbortError');
    let pending = queue.shift();
    while (pending) {
      results.push({ id: pending.id, status: 'error', error: abortError });
      pending = queue.shift();
    }
  }

  return results;
}

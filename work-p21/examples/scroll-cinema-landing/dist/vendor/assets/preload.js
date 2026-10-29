import { groupByPriority } from './manifest.js';
import { loadAsset } from './loader.js';
const PRIORITY_RANK = { critical: 0, eager: 1, lazy: 2 };
/**
 * Deterministic priority queue over manifest entries. Higher-priority
 * entries dequeue first; ties break by id for reproducible order.
 */
export class AssetPriorityQueue {
    items = [];
    constructor(entries) {
        if (entries)
            for (const [id, entry] of entries)
                this.push(id, entry);
    }
    get size() {
        return this.items.length;
    }
    push(id, entry) {
        this.items.push({ id, entry });
        this.items.sort((a, b) => PRIORITY_RANK[a.entry.preload] - PRIORITY_RANK[b.entry.preload] ||
            a.id.localeCompare(b.id));
    }
    /** Remove and return the highest-priority { id, entry }, or undefined. */
    shift() {
        return this.items.shift();
    }
    peek() {
        return this.items[0];
    }
    clear() {
        this.items.length = 0;
    }
}
/**
 * P4: cooperative pause gate for preload runs. While paused no new fetches
 * are dequeued; in-flight fetches continue (aborting wastes bytes).
 */
export class PreloadPauser {
    paused = false;
    waiters = [];
    get isPaused() {
        return this.paused;
    }
    setPaused(on) {
        if (this.paused === on)
            return;
        this.paused = on;
        if (!on) {
            const waiters = this.waiters.splice(0);
            for (const resolve of waiters)
                resolve();
        }
    }
    /** Resolves immediately when unpaused; otherwise once resumed. */
    waitWhilePaused() {
        if (!this.paused)
            return Promise.resolve();
        return new Promise((resolve) => this.waiters.push(resolve));
    }
}
/** Build a queue from a manifest, optionally restricted to a subset of ids. */
export function buildQueue(manifest, ids) {
    const queue = new AssetPriorityQueue();
    const wanted = ids ? new Set(ids) : null;
    for (const list of Object.values(groupByPriority(manifest))) {
        for (const id of list) {
            if (wanted && !wanted.has(id))
                continue;
            const entry = manifest.assets[id];
            if (entry)
                queue.push(id, entry);
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
export async function preload(queue, options = {}) {
    const concurrency = Math.max(1, options.concurrency ?? 4);
    const emit = options.emit ?? (() => undefined);
    const total = queue.size;
    let loaded = 0;
    const results = [];
    const resultById = new Map();
    emit({ loaded: 0, total });
    const loadOpts = {};
    if (options.cdnBase)
        loadOpts.cdnBase = options.cdnBase;
    if (options.signal)
        loadOpts.signal = options.signal;
    if (options.fetchImpl)
        loadOpts.fetchImpl = options.fetchImpl;
    const worker = async () => {
        for (;;) {
            if (options.signal?.aborted)
                return;
            if (options.pauser)
                await options.pauser.waitWhilePaused();
            if (options.signal?.aborted)
                return;
            const next = queue.shift();
            if (!next)
                return;
            const { id, entry } = next;
            try {
                const handle = await loadAsset(entry, loadOpts);
                const result = { id, status: 'ready', handle };
                results.push(result);
                resultById.set(id, result);
            }
            catch (cause) {
                const error = cause instanceof Error ? cause : new Error(String(cause));
                const result = { id, status: 'error', error };
                results.push(result);
                resultById.set(id, result);
            }
            loaded += 1;
            options.onResult?.(results[results.length - 1]);
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

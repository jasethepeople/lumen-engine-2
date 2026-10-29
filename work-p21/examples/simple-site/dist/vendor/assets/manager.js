import { contentHashKey, normalizeManifest, primaryUrl, resolveAssetUrl } from './manifest.js';
import { AssetCache } from './cache.js';
import { buildQueue, preload, PreloadPauser } from './preload.js';
export class AssetManager {
    manifest = null;
    handles = new Map();
    states = new Map();
    errors = new Map();
    cache;
    opts = {};
    runController = null;
    pauser = new PreloadPauser();
    constructor() {
        this.cache = new AssetCache();
    }
    /** Validate + store the manifest and (re)configure the cache. */
    init(manifest, opts = {}) {
        this.manifest = normalizeManifest(manifest);
        this.opts = opts;
        this.cache = new AssetCache(opts.cache ?? {});
        for (const id of Object.keys(this.manifest.assets))
            this.states.set(id, 'queued');
        return this.manifest;
    }
    /** The normalized manifest, or null before init. */
    getManifest() {
        return this.manifest;
    }
    /**
     * P4: pause/resume the preload queue driver (e.g. while the document is
     * hidden). In-flight fetches continue; no new fetches dequeue while paused.
     */
    setPaused(on) {
        this.pauser.setPaused(on);
    }
    /** Current LoadState of an asset id ('queued' when unknown). */
    state(id) {
        return this.states.get(id) ?? 'queued';
    }
    /**
     * Preload the given ids (or all non-ready entries when omitted).
     * Returns per-asset results; individual failures do not reject.
     */
    async preload(ids) {
        if (!this.manifest)
            throw new Error('AssetManager.init() must be called first');
        this.runController?.abort();
        const controller = new AbortController();
        this.runController = controller;
        const targets = ids ?? Object.keys(this.manifest.assets).filter((id) => !this.handles.has(id));
        const queue = buildQueue(this.manifest, targets);
        const emit = this.opts.emit;
        const fetchImpl = this.opts.fetchImpl;
        const results = await preload(queue, {
            ...(this.opts.cdnBase ? { cdnBase: this.opts.cdnBase } : {}),
            ...(this.opts.concurrency !== undefined ? { concurrency: this.opts.concurrency } : {}),
            signal: controller.signal,
            pauser: this.pauser,
            ...(fetchImpl ? { fetchImpl } : {}),
            ...(this.opts.capabilities ? { capabilities: this.opts.capabilities } : {}),
            emit: (payload) => {
                if (payload.assetId && !this.errors.has(payload.assetId)) {
                    this.states.set(payload.assetId, this.handles.has(payload.assetId) ? 'ready' : 'loading');
                }
                emit?.(payload);
            },
            onResult: (result) => {
                if (result.status === 'ready' && result.handle) {
                    this.handles.set(result.id, result.handle);
                    this.states.set(result.id, 'ready');
                }
                else {
                    if (result.error)
                        this.errors.set(result.id, result.error);
                    this.states.set(result.id, 'error');
                }
            },
        });
        return results;
    }
    /** Abort any in-flight preload run. */
    abort() {
        this.runController?.abort();
        this.runController = null;
    }
    /**
     * Get the decoded handle for an asset. Returns undefined when the asset
     * is unknown or not yet loaded — call preload() first.
     */
    get(id) {
        return this.handles.get(id);
    }
    /** Last load error for an id, if any. */
    error(id) {
        return this.errors.get(id);
    }
    stats() {
        let ready = 0;
        let loading = 0;
        let failed = 0;
        for (const state of this.states.values()) {
            if (state === 'ready')
                ready += 1;
            else if (state === 'loading')
                loading += 1;
            else if (state === 'error')
                failed += 1;
        }
        return {
            total: this.states.size,
            ready,
            loading,
            failed,
            cacheEntries: this.cache.memory.size,
            cacheBytes: this.cache.memory.bytes,
        };
    }
    /**
     * Populate the two-tier cache for an entry's primary payload. Used by
     * build/dev tooling that already has bytes in hand.
     */
    async cachePayload(id, bytes) {
        const entry = this.requireEntry(id);
        await this.cache.set(contentHashKey(entry), bytes);
    }
    /** Resolve the primary URL for an entry against the configured CDN base. */
    resolveUrl(id) {
        const entry = this.requireEntry(id);
        return resolveAssetUrl(primaryUrl(entry), this.opts.cdnBase);
    }
    /**
     * Release all handles, clear in-memory state, abort in-flight work.
     * The persistent tier (Cache API / IndexedDB) is shared origin-wide and
     * intentionally left intact — disposing one engine must not wipe cached
     * payloads for other pages or future visits.
     */
    async dispose() {
        this.abort();
        for (const handle of this.handles.values()) {
            if (handle.kind === 'video')
                handle.video.dispose();
            if (handle.kind === 'image')
                handle.bitmap?.close();
            if (handle.kind === 'font' && handle.face && typeof document !== 'undefined') {
                document.fonts.delete(handle.face);
            }
        }
        this.handles.clear();
        this.states.clear();
        this.errors.clear();
        this.cache.memory.clear();
        this.manifest = null;
    }
    requireEntry(id) {
        const entry = this.manifest?.assets[id];
        if (!entry)
            throw new Error(`unknown asset id "${id}"`);
        return entry;
    }
}
/** Convenience factory. */
export function createAssetManager() {
    return new AssetManager();
}

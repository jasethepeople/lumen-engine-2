/**
 * AssetManager — the public facade of @lumen/assets.
 *
 * Owns the normalized manifest, the two-tier cache, and preload runs.
 * Kernel-agnostic: progress leaves the manager through an injected emit
 * callback (`asset:progress` payload) supplied at init.
 */
import type { AssetManifest, CapabilityProfile, LoadState } from '@lumen/contracts';
import { contentHashKey, normalizeManifest, primaryUrl, resolveAssetUrl } from './manifest.js';
import type { AssetHandle } from './loader.js';
import { AssetCache } from './cache.js';
import { buildQueue, preload, PreloadPauser, type AssetProgressPayload, type PreloadResult } from './preload.js';

export interface AssetManagerOptions {
  /** CDN base prepended to manifest-relative URLs. */
  cdnBase?: string;
  /** Preload concurrency (default 4). */
  concurrency?: number;
  /** Progress sink; wire to kernel bus as emit('asset:progress', payload). */
  emit?: (payload: AssetProgressPayload) => void;
  /** Memory LRU bounds for the byte cache. */
  cache?: { maxEntries?: number; maxBytes?: number; cacheName?: string };
  /** Fetch override (testing / custom transport). */
  fetchImpl?: typeof fetch;
  /** Probed capability profile for variant selection (P7). */
  capabilities?: CapabilityProfile;
}

export interface AssetStats {
  /** Total manifest entries. */
  total: number;
  /** Entries with a decoded handle ready. */
  ready: number;
  /** Entries currently loading. */
  loading: number;
  /** Entries that failed. */
  failed: number;
  /** Memory-cache occupancy. */
  cacheEntries: number;
  cacheBytes: number;
}

export class AssetManager {
  private manifest: AssetManifest | null = null;
  private readonly handles = new Map<string, AssetHandle>();
  private readonly states = new Map<string, LoadState>();
  private readonly errors = new Map<string, Error>();
  private cache: AssetCache;
  private opts: AssetManagerOptions = {};
  private runController: AbortController | null = null;
  private readonly pauser = new PreloadPauser();

  constructor() {
    this.cache = new AssetCache();
  }

  /** Validate + store the manifest and (re)configure the cache. */
  init(manifest: unknown, opts: AssetManagerOptions = {}): AssetManifest {
    this.manifest = normalizeManifest(manifest);
    this.opts = opts;
    this.cache = new AssetCache(opts.cache ?? {});
    for (const id of Object.keys(this.manifest.assets)) this.states.set(id, 'queued');
    return this.manifest;
  }

  /** The normalized manifest, or null before init. */
  getManifest(): AssetManifest | null {
    return this.manifest;
  }

  /**
   * P4: pause/resume the preload queue driver (e.g. while the document is
   * hidden). In-flight fetches continue; no new fetches dequeue while paused.
   */
  setPaused(on: boolean): void {
    this.pauser.setPaused(on);
  }

  /** Current LoadState of an asset id ('queued' when unknown). */
  state(id: string): LoadState {
    return this.states.get(id) ?? 'queued';
  }

  /**
   * Preload the given ids (or all non-ready entries when omitted).
   * Returns per-asset results; individual failures do not reject.
   */
  async preload(ids?: readonly string[]): Promise<PreloadResult[]> {
    if (!this.manifest) throw new Error('AssetManager.init() must be called first');
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
        } else {
          if (result.error) this.errors.set(result.id, result.error);
          this.states.set(result.id, 'error');
        }
      },
    });

    return results;
  }

  /** Abort any in-flight preload run. */
  abort(): void {
    this.runController?.abort();
    this.runController = null;
  }

  /**
   * Get the decoded handle for an asset. Returns undefined when the asset
   * is unknown or not yet loaded — call preload() first.
   */
  get(id: string): AssetHandle | undefined {
    return this.handles.get(id);
  }

  /** Last load error for an id, if any. */
  error(id: string): Error | undefined {
    return this.errors.get(id);
  }

  stats(): AssetStats {
    let ready = 0;
    let loading = 0;
    let failed = 0;
    for (const state of this.states.values()) {
      if (state === 'ready') ready += 1;
      else if (state === 'loading') loading += 1;
      else if (state === 'error') failed += 1;
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
  async cachePayload(id: string, bytes: ArrayBuffer): Promise<void> {
    const entry = this.requireEntry(id);
    await this.cache.set(contentHashKey(entry), bytes);
  }

  /** Resolve the primary URL for an entry against the configured CDN base. */
  resolveUrl(id: string): string {
    const entry = this.requireEntry(id);
    return resolveAssetUrl(primaryUrl(entry), this.opts.cdnBase);
  }

  /**
   * Release all handles, clear in-memory state, abort in-flight work.
   * The persistent tier (Cache API / IndexedDB) is shared origin-wide and
   * intentionally left intact — disposing one engine must not wipe cached
   * payloads for other pages or future visits.
   */
  async dispose(): Promise<void> {
    this.abort();
    for (const handle of this.handles.values()) {
      if (handle.kind === 'video') handle.video.dispose();
      if (handle.kind === 'image') handle.bitmap?.close();
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

  private requireEntry(id: string) {
    const entry = this.manifest?.assets[id];
    if (!entry) throw new Error(`unknown asset id "${id}"`);
    return entry;
  }
}

/** Convenience factory. */
export function createAssetManager(): AssetManager {
  return new AssetManager();
}

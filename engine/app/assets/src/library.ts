/**
 * AssetLibrary — store of processed assets for the builder's asset picker.
 *
 * In-memory by default; pass a StorageLike adapter (localStorage in the
 * browser, a Map-backed stub in tests) to persist records as JSON under a
 * single key. The store is local-only: no network calls.
 */
import type { HybridManifest } from './manifest-generator.js';

export interface ProcessedAssetRecord {
  assetId: string;
  name: string;
  /** Hybrid variant manifest emitted by HybridManifestGenerator. */
  manifest: HybridManifest;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Device classes this asset was optimized for. */
  deviceProfiles: string[];
}

/** Minimal Web Storage subset (satisfied by localStorage). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AssetLibraryOptions {
  /** Optional persistence adapter (e.g. globalThis.localStorage). */
  storage?: StorageLike;
  /** Storage key (default 'lumen.asset-library.v1'). */
  storageKey?: string;
  /** Injectable clock returning an ISO string (test determinism). */
  now?: () => string;
}

export const DEFAULT_STORAGE_KEY = 'lumen.asset-library.v1';

export class AssetLibrary {
  private readonly records = new Map<string, ProcessedAssetRecord>();
  private readonly storage?: StorageLike;
  private readonly storageKey: string;
  private readonly now: () => string;

  constructor(options: AssetLibraryOptions = {}) {
    this.storage = options.storage;
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.now = options.now ?? (() => new Date().toISOString());
    this.load();
  }

  /** Add or replace a record; createdAt is filled in when omitted. */
  put(record: Omit<ProcessedAssetRecord, 'createdAt'> & { createdAt?: string }): ProcessedAssetRecord {
    const full: ProcessedAssetRecord = { ...record, createdAt: record.createdAt ?? this.now() };
    this.records.set(full.assetId, full);
    this.persist();
    return { ...full };
  }

  get(assetId: string): ProcessedAssetRecord | undefined {
    const r = this.records.get(assetId);
    return r ? { ...r } : undefined;
  }

  /** All records, sorted by createdAt then assetId for deterministic UI order. */
  list(): ProcessedAssetRecord[] {
    return [...this.records.values()]
      .map((r) => ({ ...r }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.assetId.localeCompare(b.assetId));
  }

  delete(assetId: string): boolean {
    const removed = this.records.delete(assetId);
    if (removed) this.persist();
    return removed;
  }

  clear(): void {
    this.records.clear();
    this.persist();
  }

  get size(): number {
    return this.records.size;
  }

  private load(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.storageKey);
    } catch {
      return; // storage unavailable (privacy mode, quota) — stay in-memory
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { records?: ProcessedAssetRecord[] };
      for (const r of parsed.records ?? []) {
        if (typeof r?.assetId === 'string') this.records.set(r.assetId, r);
      }
    } catch {
      // Corrupt payload: ignore rather than break the builder.
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        this.storageKey,
        JSON.stringify({ records: [...this.records.values()] }),
      );
    } catch {
      // Quota/serialization failures are non-fatal; memory copy stays authoritative.
    }
  }
}

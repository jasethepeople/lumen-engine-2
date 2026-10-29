/**
 * @lumen/app-community — local persistence seam.
 *
 * Mirrors the marketplace/collaboration StorageLike convention: a minimal
 * string key/value interface satisfied by `localStorage` in the browser and
 * by {@link MemoryCommunityStorage} in tests/headless runs. All community
 * stores serialize their records as JSON under one key each; zero network.
 */

/** Minimal string key/value store (subset of the DOM Storage interface). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory StorageLike (default when no localStorage is present). */
export class MemoryCommunityStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** StorageLike adapter over a DOM-style localStorage object. */
export class LocalStorageCommunityStorage implements StorageLike {
  constructor(
    private readonly storage: StorageLike = (globalThis as { localStorage?: StorageLike })
      .localStorage as StorageLike,
  ) {
    if (!this.storage) {
      throw new Error('LocalStorageCommunityStorage: no localStorage available');
    }
  }

  getItem(key: string): string | null {
    return this.storage.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  removeItem(key: string): void {
    this.storage.removeItem(key);
  }
}

/** Resolve the default storage: global localStorage when present, else memory. */
export function defaultCommunityStorage(): StorageLike {
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? new MemoryCommunityStorage();
}

/** Read a JSON payload; missing/corrupt payloads fall back. */
export function readJson<T>(storage: StorageLike, key: string, fallback: T): T {
  const raw = storage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Write a JSON payload. */
export function writeJson(storage: StorageLike, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value));
}

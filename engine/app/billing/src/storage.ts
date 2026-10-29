/**
 * BillingStorage implementations: in-memory (default) and a localStorage
 * adapter guarded for non-browser environments.
 */
import type { BillingStorage, Subscription } from './types.js';

/** Default storage: a plain in-memory Map. */
export class MemoryBillingStorage implements BillingStorage {
  private readonly map = new Map<string, Subscription>();

  get(userId: string): Subscription | undefined {
    const sub = this.map.get(userId);
    return sub ? { ...sub } : undefined;
  }

  set(subscription: Subscription): void {
    this.map.set(subscription.userId, { ...subscription });
  }

  delete(userId: string): void {
    this.map.delete(userId);
  }

  all(): Subscription[] {
    return [...this.map.values()].map((s) => ({ ...s }));
  }
}

/**
 * Minimal structural view of the Web Storage API so this file compiles in
 * non-DOM type environments too.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

const DEFAULT_PREFIX = 'lumen:billing:';

/**
 * Persists subscriptions into `localStorage` (or any injected Web Storage).
 * In non-browser environments (no global localStorage and none injected) the
 * adapter falls back to an internal in-memory map so it never throws.
 */
export class LocalStorageBillingAdapter implements BillingStorage {
  private readonly prefix: string;
  private readonly backing: KeyValueStorage | undefined;
  private readonly fallback = new MemoryBillingStorage();

  constructor(options: { storage?: KeyValueStorage; prefix?: string } = {}) {
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.backing =
      options.storage ??
      (typeof localStorage !== 'undefined' ? localStorage : undefined);
  }

  private get store(): KeyValueStorage | undefined {
    return this.backing;
  }

  get(userId: string): Subscription | undefined {
    if (!this.store) return this.fallback.get(userId);
    const raw = this.store.getItem(this.prefix + userId);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as Subscription;
    } catch {
      return undefined;
    }
  }

  set(subscription: Subscription): void {
    if (!this.store) {
      this.fallback.set(subscription);
      return;
    }
    this.store.setItem(this.prefix + subscription.userId, JSON.stringify(subscription));
  }

  delete(userId: string): void {
    if (!this.store) {
      this.fallback.delete(userId);
      return;
    }
    this.store.removeItem(this.prefix + userId);
  }

  all(): Subscription[] {
    if (!this.store) return this.fallback.all();
    const out: Subscription[] = [];
    for (let i = 0; i < this.store.length; i++) {
      const key = this.store.key(i);
      if (key && key.startsWith(this.prefix)) {
        const raw = this.store.getItem(key);
        if (raw !== null) {
          try {
            out.push(JSON.parse(raw) as Subscription);
          } catch {
            /* skip corrupt entries */
          }
        }
      }
    }
    return out;
  }
}

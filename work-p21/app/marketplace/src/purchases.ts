/**
 * @lumen/app-marketplace — template purchase flow (Phase 15).
 *
 * Fully offline: the billing side is a mock TemplateBillingProvider seam
 * (a per-item analogue of @lumen/app-billing's MockBillingProvider — the
 * subscription provider stays untouched). A successful charge records a
 * Purchase in a pluggable PurchaseStore (memory or localStorage-backed);
 * ownsTemplate() answers the ownership question the entitlement layer
 * consumes.
 */

import type { PaidTemplateMeta, TemplatePrice } from './paid.js';
import { getPricedTemplate, isPaidTemplateMeta } from './paid.js';
import type { TemplateMeta } from './meta.js';

/** A recorded template purchase. */
export interface Purchase {
  id: string;
  userId: string;
  templateId: string;
  /** Charged amount in cents. */
  amountCents: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** Author/creator attributed with the sale (for revenue share). */
  authorId: string;
  /** Epoch milliseconds of the purchase. */
  purchasedAt: number;
}

/** Persistence abstraction for purchases (synchronous, like BillingStorage). */
export interface PurchaseStore {
  add(purchase: Purchase): void;
  get(purchaseId: string): Purchase | undefined;
  listByUser(userId: string): Purchase[];
  list(): Purchase[];
}

/** In-memory PurchaseStore (default; process-lifetime). */
export class MemoryPurchaseStore implements PurchaseStore {
  private readonly records = new Map<string, Purchase>();

  add(purchase: Purchase): void {
    this.records.set(purchase.id, { ...purchase });
  }

  get(purchaseId: string): Purchase | undefined {
    const r = this.records.get(purchaseId);
    return r === undefined ? undefined : { ...r };
  }

  listByUser(userId: string): Purchase[] {
    return this.list().filter((p) => p.userId === userId);
  }

  list(): Purchase[] {
    return [...this.records.values()]
      .map((p) => ({ ...p }))
      .sort((a, b) => a.purchasedAt - b.purchasedAt || (a.id < b.id ? -1 : 1));
  }
}

/** Minimal Storage shape (subset of the DOM Storage interface). */
export interface PurchaseStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'lumen.marketplace.purchases.v1';

/** LocalStorage-backed PurchaseStore (browser persistence). */
export class LocalStoragePurchaseStore implements PurchaseStore {
  constructor(
    private readonly storage: PurchaseStorageLike = (globalThis as { localStorage?: PurchaseStorageLike })
      .localStorage as PurchaseStorageLike,
  ) {
    if (!this.storage) {
      throw new Error('LocalStoragePurchaseStore: no localStorage available in this environment');
    }
  }

  private readAll(): Purchase[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    try {
      return JSON.parse(raw) as Purchase[];
    } catch {
      return [];
    }
  }

  private writeAll(records: Purchase[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  add(purchase: Purchase): void {
    this.writeAll([...this.readAll(), { ...purchase }]);
  }

  get(purchaseId: string): Purchase | undefined {
    const found = this.readAll().find((p) => p.id === purchaseId);
    return found === undefined ? undefined : { ...found };
  }

  listByUser(userId: string): Purchase[] {
    return this.readAll().filter((p) => p.userId === userId);
  }

  list(): Purchase[] {
    return this.readAll().map((p) => ({ ...p }));
  }
}

/** Receipt returned by the mock billing seam for a template charge. */
export interface TemplateChargeReceipt {
  id: string;
  userId: string;
  amountCents: number;
  currency: string;
  status: 'completed';
  createdAt: number;
}

/**
 * Mock billing seam for one-off template purchases. Mirrors the shape of
 * @lumen/app-billing's BillingProvider but charges per item instead of
 * managing subscriptions. Fully offline; the charge always succeeds.
 */
export interface TemplateBillingProvider {
  charge(userId: string, price: TemplatePrice): Promise<TemplateChargeReceipt>;
}

/** Injectable clock for deterministic tests. */
export type PurchaseClock = () => number;

let receiptCounter = 0;

/** Default mock provider: every charge completes instantly. */
export class MockTemplateBillingProvider implements TemplateBillingProvider {
  constructor(private readonly clock: PurchaseClock = () => Date.now()) {}

  charge(userId: string, price: TemplatePrice): Promise<TemplateChargeReceipt> {
    if (!Number.isInteger(price.amountCents) || price.amountCents < 0) {
      return Promise.reject(
        new Error(`MockTemplateBillingProvider: invalid amount ${price.amountCents}`),
      );
    }
    const now = this.clock();
    receiptCounter += 1;
    return Promise.resolve({
      id: `mock_charge_${now}_${receiptCounter}`,
      userId,
      amountCents: price.amountCents,
      currency: price.currency,
      status: 'completed',
      createdAt: now,
    });
  }
}

/** Error raised for unknown templates or attempts to buy free templates. */
export class PurchaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseError';
  }
}

/**
 * Marketplace purchase facade. Resolves the template (from the priced sample
 * index or a caller-supplied resolver), charges through the mock billing
 * seam, and records the Purchase. Never partially records: a failed charge
 * leaves the store untouched.
 */
export class TemplatePurchases {
  constructor(
    private readonly store: PurchaseStore = new MemoryPurchaseStore(),
    private readonly provider: TemplateBillingProvider = new MockTemplateBillingProvider(),
    private readonly clock: PurchaseClock = () => Date.now(),
    private readonly resolve: (templateId: string) => TemplateMeta | undefined = getPricedTemplate,
  ) {}

  /** The underlying purchase store. */
  get purchases(): PurchaseStore {
    return this.store;
  }

  /**
   * Purchase a paid template for a user. Idempotent per user/template:
   * repeat purchases return the existing record without re-charging.
   */
  async purchaseTemplate(userId: string, templateId: string): Promise<Purchase> {
    if (this.ownsTemplate(userId, templateId)) {
      const existing = this.store
        .listByUser(userId)
        .find((p) => p.templateId === templateId);
      if (existing !== undefined) return existing;
    }
    const meta = this.resolve(templateId);
    if (meta === undefined) {
      throw new PurchaseError(`Unknown template '${templateId}'`);
    }
    if (!isPaidTemplateMeta(meta)) {
      throw new PurchaseError(`Template '${templateId}' is free; nothing to purchase`);
    }
    const paid: PaidTemplateMeta = meta;
    const receipt = await this.provider.charge(userId, paid.price);
    const purchase: Purchase = {
      id: `purchase_${receipt.id}`,
      userId,
      templateId,
      amountCents: receipt.amountCents,
      currency: receipt.currency,
      authorId: paid.author,
      purchasedAt: this.clock(),
    };
    this.store.add(purchase);
    return { ...purchase };
  }

  /** True when the user has a recorded purchase for the template. */
  ownsTemplate(userId: string, templateId: string): boolean {
    return this.store.listByUser(userId).some((p) => p.templateId === templateId);
  }
}

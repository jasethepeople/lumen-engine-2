/**
 * MockBillingProvider — a fully offline BillingProvider.
 *
 * checkout() completes immediately (no redirect, no webhooks); state lives in
 * a pluggable BillingStorage and all timestamps come from an injectable clock.
 */
import { FREE_PLAN_ID, isPlanId } from './plans.js';
import { MemoryBillingStorage } from './storage.js';
import type {
  BillingProvider,
  BillingStorage,
  CheckoutSession,
  Clock,
  Subscription,
} from './types.js';
import { systemClock } from './types.js';

/** One billing period: 30 days in milliseconds. */
export const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface MockBillingProviderOptions {
  storage?: BillingStorage;
  clock?: Clock;
}

let sessionCounter = 0;

export class MockBillingProvider implements BillingProvider {
  private readonly storage: BillingStorage;
  private readonly clock: Clock;

  constructor(options: MockBillingProviderOptions = {}) {
    this.storage = options.storage ?? new MemoryBillingStorage();
    this.clock = options.clock ?? systemClock;
  }

  /** Users with no stored record are implicitly on the free plan. */
  async getSubscription(userId: string): Promise<Subscription> {
    const existing = this.storage.get(userId);
    if (existing) return existing;
    const now = this.clock();
    return {
      userId,
      planId: FREE_PLAN_ID,
      status: 'active',
      currentPeriodEnd: now + PERIOD_MS,
      updatedAt: now,
    };
  }

  /**
   * Instantly completes a checkout and activates the plan. Unknown plan ids
   * are rejected — the catalog is the source of truth.
   */
  async checkout(userId: string, planId: string): Promise<CheckoutSession> {
    if (!isPlanId(planId)) {
      throw new Error(`MockBillingProvider: unknown plan '${planId}'`);
    }
    const now = this.clock();
    const subscription: Subscription = {
      userId,
      planId,
      status: 'active',
      currentPeriodEnd: now + PERIOD_MS,
      updatedAt: now,
    };
    this.storage.set(subscription);
    sessionCounter += 1;
    return {
      id: `mock_checkout_${now}_${sessionCounter}`,
      userId,
      planId,
      status: 'completed',
      createdAt: now,
    };
  }

  /** Cancels the paid plan; the user reverts to free with status 'canceled'. */
  async cancel(userId: string): Promise<Subscription> {
    const now = this.clock();
    const canceled: Subscription = {
      userId,
      planId: FREE_PLAN_ID,
      status: 'canceled',
      currentPeriodEnd: now,
      updatedAt: now,
    };
    this.storage.set(canceled);
    return { ...canceled };
  }
}

/**
 * Core billing types: subscription shape, provider contract, storage contract.
 */

export type SubscriptionStatus = 'active' | 'canceled' | 'trialing';

export interface Subscription {
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  /** Epoch milliseconds when the current paid period ends. */
  currentPeriodEnd: number;
  /** Epoch milliseconds of the last state mutation. */
  updatedAt: number;
}

/**
 * Result of a checkout call. In the mock provider the session is immediately
 * 'completed' — there is no redirect or webhook round-trip.
 */
export interface CheckoutSession {
  id: string;
  userId: string;
  planId: string;
  status: 'completed';
  createdAt: number;
}

export interface BillingProvider {
  /** Returns the user's subscription; users with no record are on free. */
  getSubscription(userId: string): Promise<Subscription>;
  /** Starts (and, in the mock, instantly completes) a checkout for a plan. */
  checkout(userId: string, planId: string): Promise<CheckoutSession>;
  /** Cancels the user's subscription, reverting them to the free plan. */
  cancel(userId: string): Promise<Subscription>;
}

/**
 * Pluggable persistence for subscriptions. Implementations must be
 * synchronous; async durability is out of scope for the mock layer.
 */
export interface BillingStorage {
  get(userId: string): Subscription | undefined;
  set(subscription: Subscription): void;
  delete(userId: string): void;
  /** Lists every stored subscription (used by tests and admin tooling). */
  all(): Subscription[];
}

/** Injectable clock for deterministic tests. Returns epoch milliseconds. */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();

export {
  PLANS,
  FREE_PLAN_ID,
  PRO_PLAN_ID,
  getPlan,
  isPlanId,
} from './plans.js';
export type { PlanDescriptor } from './plans.js';
export type {
  BillingProvider,
  BillingStorage,
  CheckoutSession,
  Clock,
  Subscription,
  SubscriptionStatus,
} from './types.js';
export { systemClock } from './types.js';
export { MemoryBillingStorage, LocalStorageBillingAdapter } from './storage.js';
export type { KeyValueStorage } from './storage.js';
export { MockBillingProvider, PERIOD_MS } from './provider.js';
export type { MockBillingProviderOptions } from './provider.js';

// --- Phase 15: revenue share (additive) ---
export {
  CREATOR_SHARE_RATIO,
  PLATFORM_SHARE_RATIO,
  RevenueShareLedger,
  type Payout,
  type RevenueClock,
  type RevenueShareEntry,
  type RevenueSharePurchase,
} from './revenue.js';

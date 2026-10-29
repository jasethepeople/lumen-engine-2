/**
 * @lumen/app-billing — mock revenue share ledger (Phase 15).
 *
 * Every template purchase is split between the platform and the creator:
 * 30% platform / 70% creator, computed in integer cents (creator share is
 * rounded; the platform absorbs the remainder so the split always sums to
 * the full amount). Fully offline — requestPayout() is a stub that schedules
 * a payout without transferring anything.
 */

/** Platform share of each purchase (creator gets the rest). */
export const PLATFORM_SHARE_RATIO = 0.3;
/** Creator share of each purchase. */
export const CREATOR_SHARE_RATIO = 0.7;

/** One ledger entry: the split of a single purchase. */
export interface RevenueShareEntry {
  id: string;
  /** Purchase identifier this entry splits. */
  purchaseId: string;
  /** Creator/author credited with the sale. */
  authorId: string;
  /** Full purchase amount in cents. */
  amountCents: number;
  /** Creator's 70% share in cents (rounded). */
  creatorShareCents: number;
  /** Platform's share in cents (amount - creator share). */
  platformShareCents: number;
  /** Epoch milliseconds when the entry was recorded. */
  recordedAt: number;
}

/** Input describing a completed purchase to split. */
export interface RevenueSharePurchase {
  purchaseId: string;
  authorId: string;
  amountCents: number;
}

/** A scheduled (mock) payout. */
export interface Payout {
  payoutId: string;
  authorId: string;
  amountCents: number;
  status: 'scheduled';
  /** Epoch milliseconds when the payout was requested. */
  requestedAt: number;
}

/** Injectable clock for deterministic tests. */
export type RevenueClock = () => number;

let entryCounter = 0;
let payoutCounter = 0;

/**
 * In-memory revenue share ledger. Entries are append-only; earnings queries
 * aggregate over them. requestPayout() schedules a payout for the creator's
 * outstanding balance and marks those entries as paid out internally.
 */
export class RevenueShareLedger {
  private readonly entries: RevenueShareEntry[] = [];
  private readonly paidOutEntryIds = new Set<string>();

  constructor(private readonly clock: RevenueClock = () => Date.now()) {}

  /**
   * Record the revenue split of a purchase. Integer-cent math: the creator
   * share is round(amount * 0.7) and the platform takes the remainder, so
   * creatorShareCents + platformShareCents === amountCents always.
   */
  recordPurchase(purchase: RevenueSharePurchase): RevenueShareEntry {
    if (!Number.isInteger(purchase.amountCents) || purchase.amountCents < 0) {
      throw new Error(
        `RevenueShareLedger: amountCents must be a non-negative integer, got ${purchase.amountCents}`,
      );
    }
    entryCounter += 1;
    const creatorShareCents = Math.round(purchase.amountCents * CREATOR_SHARE_RATIO);
    const entry: RevenueShareEntry = {
      id: `rev_${this.clock()}_${entryCounter}`,
      purchaseId: purchase.purchaseId,
      authorId: purchase.authorId,
      amountCents: purchase.amountCents,
      creatorShareCents,
      platformShareCents: purchase.amountCents - creatorShareCents,
      recordedAt: this.clock(),
    };
    this.entries.push(entry);
    return { ...entry };
  }

  /** All ledger entries (defensive copies, chronological). */
  list(): RevenueShareEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  /** Total creator earnings in cents. Settled entries are excluded when `outstandingOnly`. */
  creatorEarnings(authorId: string, options: { outstandingOnly?: boolean } = {}): number {
    return this.entries
      .filter(
        (e) =>
          e.authorId === authorId &&
          (!options.outstandingOnly || !this.paidOutEntryIds.has(e.id)),
      )
      .reduce((sum, e) => sum + e.creatorShareCents, 0);
  }

  /** Total platform revenue in cents across all entries. */
  platformRevenue(): number {
    return this.entries.reduce((sum, e) => sum + e.platformShareCents, 0);
  }

  /**
   * Mock payout: schedules a payout for the creator's outstanding balance
   * and settles those entries. No transfer happens. Requesting a payout with
   * a zero outstanding balance still succeeds with amountCents 0.
   */
  requestPayout(authorId: string): Payout {
    const outstanding = this.entries.filter(
      (e) => e.authorId === authorId && !this.paidOutEntryIds.has(e.id),
    );
    const amountCents = outstanding.reduce((sum, e) => sum + e.creatorShareCents, 0);
    for (const entry of outstanding) this.paidOutEntryIds.add(entry.id);
    payoutCounter += 1;
    return {
      payoutId: `payout_${this.clock()}_${payoutCounter}`,
      authorId,
      amountCents,
      status: 'scheduled',
      requestedAt: this.clock(),
    };
  }
}

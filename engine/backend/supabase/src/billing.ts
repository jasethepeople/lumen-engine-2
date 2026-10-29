/**
 * HostedBilling — subscription reads from `subscriptions` (user reads own
 * row; writes are service-role only) plus a MOCK plan-switch seam that goes
 * through the documented rpc('mock_set_plan') / 'billing-mock' edge function
 * (no real payment provider in Phase 21). Creator revenue reads come from
 * the `payouts` + `revenue_ledger` views (author reads own rows).
 */
import type { SupabaseClientLike } from './client.js';
import { unwrap, unwrapRows } from './client.js';

export type HostedPlanId = 'free' | 'pro';

export interface HostedSubscription {
  userId: string;
  planId: HostedPlanId;
  status: string;
  currentPeriodEnd?: string;
  updatedAt: string;
}

export interface HostedPayout {
  id: string;
  authorId: string;
  amountCents: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

export interface HostedRevenueEntry {
  id: number;
  purchaseId: string;
  authorId: string;
  amountCents: number;
  creatorCents: number;
  platformCents: number;
  settled: boolean;
  createdAt: string;
}

interface SubscriptionRow {
  user_id: string;
  plan_id: HostedPlanId;
  status: string;
  current_period_end: string | null;
  updated_at: string;
}

interface PayoutRow {
  id: string;
  author_id: string;
  amount_cents: number;
  status: string;
  period_start: string;
  period_end: string;
  created_at: string;
}

interface RevenueRow {
  id: number;
  purchase_id: string;
  author_id: string;
  amount_cents: number;
  creator_cents: number;
  platform_cents: number;
  settled: boolean;
  created_at: string;
}

export interface HostedBillingOptions {
  userId?: () => Promise<string | undefined>;
}

export class HostedBilling {
  private readonly client: SupabaseClientLike;
  private readonly resolveUserId: () => Promise<string | undefined>;

  constructor(client: SupabaseClientLike, options: HostedBillingOptions = {}) {
    this.client = client;
    this.resolveUserId =
      options.userId ??
      (async () => (await this.client.auth.getUser()).data?.id ?? undefined);
  }

  private async requireUserId(): Promise<string> {
    const id = await this.resolveUserId();
    if (!id) throw new Error('billing: no authenticated user');
    return id;
  }

  /** Current user's subscription (undefined when none — i.e. free tier). */
  async getSubscription(): Promise<HostedSubscription | undefined> {
    const userId = await this.requireUserId();
    const { data, error } = await this.client
      .from('subscriptions')
      .select()
      .eq('user_id', userId)
      .single();
    if (error) return undefined;
    if (!data) return undefined;
    const row = data as SubscriptionRow;
    const sub: HostedSubscription = {
      userId: row.user_id,
      planId: row.plan_id,
      status: row.status,
      updatedAt: row.updated_at,
    };
    if (row.current_period_end !== null) sub.currentPeriodEnd = row.current_period_end;
    return sub;
  }

  /** Effective plan id ('free' when no subscription row exists). */
  async currentPlan(): Promise<HostedPlanId> {
    return (await this.getSubscription())?.planId ?? 'free';
  }

  /**
   * Mock plan switch (no real payments): documented seam invoking the
   * 'billing-mock' edge function, which service-role-updates the
   * subscriptions row. Direct table writes are rejected by RLS by design.
   */
  async switchPlan(planId: HostedPlanId): Promise<void> {
    const { error } = await this.client.functions.invoke('billing-mock', {
      body: { plan_id: planId },
    });
    if (error) throw new Error(`billing.switchPlan: ${error.message}`);
  }

  /** Creator revenue: own payouts. */
  async listPayouts(): Promise<HostedPayout[]> {
    const authorId = await this.requireUserId();
    const rows = await unwrapRows<PayoutRow>(
      this.client
        .from('payouts')
        .select()
        .eq('author_id', authorId)
        .order('created_at', { ascending: false }),
      'billing.listPayouts',
    );
    return rows.map((r) => ({
      id: r.id,
      authorId: r.author_id,
      amountCents: r.amount_cents,
      status: r.status,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      createdAt: r.created_at,
    }));
  }

  /** Creator revenue: own revenue_ledger entries. */
  async listRevenue(): Promise<HostedRevenueEntry[]> {
    const authorId = await this.requireUserId();
    const rows = await unwrapRows<RevenueRow>(
      this.client
        .from('revenue_ledger')
        .select()
        .eq('author_id', authorId)
        .order('created_at', { ascending: false }),
      'billing.listRevenue',
    );
    return rows.map((r) => ({
      id: r.id,
      purchaseId: r.purchase_id,
      authorId: r.author_id,
      amountCents: r.amount_cents,
      creatorCents: r.creator_cents,
      platformCents: r.platform_cents,
      settled: r.settled,
      createdAt: r.created_at,
    }));
  }

  /** Convenience: fetch the current subscriptions row (typed, throwing). */
  async requireSubscription(): Promise<HostedSubscription> {
    const userId = await this.requireUserId();
    const row = await unwrap<SubscriptionRow>(
      this.client.from('subscriptions').select().eq('user_id', userId).single(),
      'billing.requireSubscription',
    );
    const sub: HostedSubscription = {
      userId: row.user_id,
      planId: row.plan_id,
      status: row.status,
      updatedAt: row.updated_at,
    };
    if (row.current_period_end !== null) sub.currentPeriodEnd = row.current_period_end;
    return sub;
  }
}

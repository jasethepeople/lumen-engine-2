/**
 * HostedEntitlementResolver — resolves the caller's plan from the
 * `subscriptions` table and their individually-purchased template ids from
 * `purchases`, then feeds the EXISTING pure gating functions from
 * @lumen/app-entitlements (EntitlementService / canAccessTemplate). Gating
 * logic is never reimplemented here; this module is I/O only.
 */
import {
  EntitlementService,
  canAccessTemplate,
  type EntitlementKey,
  type OwnershipResolver,
  type TemplateAccessMeta,
} from '@lumen/app-entitlements';
import type { SupabaseClientLike } from './client.js';
import { unwrapRows } from './client.js';

export interface ResolvedEntitlements {
  planId: string;
  purchasedTemplateIds: ReadonlySet<string>;
  service: EntitlementService;
}

export interface HostedEntitlementResolverOptions {
  userId?: () => Promise<string | undefined>;
}

export class HostedEntitlementResolver {
  private readonly client: SupabaseClientLike;
  private readonly resolveUserId: () => Promise<string | undefined>;

  constructor(client: SupabaseClientLike, options: HostedEntitlementResolverOptions = {}) {
    this.client = client;
    this.resolveUserId =
      options.userId ??
      (async () => (await this.client.auth.getUser()).data?.id ?? undefined);
  }

  /** Fetch plan + purchases and build a pure EntitlementService. */
  async resolve(): Promise<ResolvedEntitlements> {
    const userId = await this.resolveUserId();
    let planId = 'free';
    const purchasedTemplateIds = new Set<string>();
    if (userId) {
      const { data, error } = await this.client
        .from('subscriptions')
        .select()
        .eq('user_id', userId)
        .single();
      if (!error && data) {
        planId = (data as { plan_id: string }).plan_id;
      }
      const purchases = await unwrapRows<{ template_id: string }>(
        this.client.from('purchases').select('template_id').eq('user_id', userId),
        'entitlements.purchases',
      );
      for (const p of purchases) purchasedTemplateIds.add(p.template_id);
    }
    const service = new EntitlementService(() => planId);
    return { planId, purchasedTemplateIds, service };
  }

  async planId(): Promise<string> {
    return (await this.resolve()).planId;
  }

  async can(key: EntitlementKey): Promise<boolean> {
    return (await this.resolve()).service.can(key);
  }

  async assertCan(key: EntitlementKey): Promise<void> {
    (await this.resolve()).service.assertCan(key);
  }

  /**
   * Pure template gating: pro plan unlocks everything; on free, an
   * individual purchase (from the `purchases` set) grants access.
   */
  async canAccessTemplate(meta: TemplateAccessMeta): Promise<boolean> {
    const { service, purchasedTemplateIds } = await this.resolve();
    const userId = (await this.resolveUserId()) ?? '';
    const owns: OwnershipResolver = (_user, templateId) =>
      purchasedTemplateIds.has(templateId);
    return canAccessTemplate(service, userId, meta, owns);
  }
}

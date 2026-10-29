/**
 * HostedCatalog — hosted counterpart of the @lumen/app-marketplace catalog
 * and creator/purchase flows, bound to `templates` + `purchases` tables.
 *
 * Rows map onto the marketplace TemplateMeta shape so the Builder can swap
 * local ↔ hosted catalogs transparently. Creator uploads validate
 * entry_config client-side with @lumen/config's parseConfig before insert.
 * Purchases self-insert into `purchases` (authenticated; the
 * `purchases_after_insert` trigger writes the revenue_ledger split) and are
 * confirmed through the documented mock-checkout edge seam.
 */
import { parseConfig } from '@lumen/config';
import type { SupabaseClientLike } from './client.js';
import { unwrap, unwrapRows } from './client.js';

/** Marketplace TemplateMeta-compatible shape (mirrors @lumen/app-marketplace). */
export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  templateKind: string;
  version: string;
  categories: string[];
  tags: string[];
  thumbnail: string;
  tier: 'free' | 'pro';
  author: string;
  engineMinVersion: string;
  entryConfig: unknown;
  priceCents?: number;
  currency?: string;
}

export interface HostedPurchase {
  id: string;
  userId: string;
  templateId: string;
  amountCents: number;
  createdAt: string;
}

export interface CreatorUploadInput {
  id: string;
  name: string;
  description: string;
  templateKind: string;
  version: string;
  categories: string[];
  tags: string[];
  tier: 'free' | 'pro';
  priceCents?: number;
  thumbnail: string;
  engineMinVersion: string;
  entryConfig: unknown;
}

interface TemplateRow {
  id: string;
  author_id: string;
  name: string;
  description: string;
  template_kind: string;
  version: string;
  categories: string[];
  tags: string[];
  tier: 'free' | 'pro';
  price_cents: number | null;
  currency: string;
  entry_config: unknown;
  thumbnail: string;
  engine_min_version: string;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  template_id: string;
  amount_cents: number;
  created_at: string;
}

export function toTemplateMeta(row: TemplateRow): TemplateMeta {
  const meta: TemplateMeta = {
    id: row.id,
    name: row.name,
    description: row.description,
    templateKind: row.template_kind,
    version: row.version,
    categories: row.categories,
    tags: row.tags,
    thumbnail: row.thumbnail,
    tier: row.tier,
    author: row.author_id,
    engineMinVersion: row.engine_min_version,
    entryConfig: row.entry_config,
  };
  if (row.price_cents !== null) meta.priceCents = row.price_cents;
  if (row.currency) meta.currency = row.currency;
  return meta;
}

function toPurchase(row: PurchaseRow): HostedPurchase {
  return {
    id: row.id,
    userId: row.user_id,
    templateId: row.template_id,
    amountCents: row.amount_cents,
    createdAt: row.created_at,
  };
}

export interface HostedCatalogOptions {
  userId?: () => Promise<string | undefined>;
}

export class HostedCatalog {
  private readonly client: SupabaseClientLike;
  private readonly resolveUserId: () => Promise<string | undefined>;

  constructor(client: SupabaseClientLike, options: HostedCatalogOptions = {}) {
    this.client = client;
    this.resolveUserId =
      options.userId ??
      (async () => (await this.client.auth.getUser()).data?.id ?? undefined);
  }

  private async requireUserId(): Promise<string> {
    const id = await this.resolveUserId();
    if (!id) throw new Error('marketplace: no authenticated user');
    return id;
  }

  async listTemplates(): Promise<TemplateMeta[]> {
    const rows = await unwrapRows<TemplateRow>(
      this.client.from('templates').select().order('created_at', { ascending: false }),
      'marketplace.listTemplates',
    );
    return rows.map(toTemplateMeta);
  }

  async getTemplate(id: string): Promise<TemplateMeta | undefined> {
    const { data, error } = await this.client
      .from('templates')
      .select()
      .eq('id', id)
      .single();
    if (error) return undefined;
    return data ? toTemplateMeta(data as TemplateRow) : undefined;
  }

  /**
   * Purchase a template: confirm through the mock-checkout edge seam, then
   * record the self-insert into `purchases` (unique(user_id, template_id)).
   */
  async purchase(templateId: string): Promise<HostedPurchase> {
    const userId = await this.requireUserId();
    const template = await this.getTemplate(templateId);
    if (!template) throw new Error(`purchase: template not found: ${templateId}`);
    const amountCents = template.priceCents ?? 0;
    const { error: checkoutError } = await this.client.functions.invoke('mock-checkout', {
      body: { template_id: templateId, amount_cents: amountCents },
    });
    if (checkoutError) throw new Error(`purchase.checkout: ${checkoutError.message}`);
    const row = await unwrap<PurchaseRow>(
      this.client
        .from('purchases')
        .insert({ user_id: userId, template_id: templateId, amount_cents: amountCents })
        .select()
        .single(),
      'purchase.insert',
    );
    return toPurchase(row);
  }

  async listPurchases(): Promise<HostedPurchase[]> {
    const userId = await this.requireUserId();
    const rows = await unwrapRows<PurchaseRow>(
      this.client.from('purchases').select().eq('user_id', userId),
      'marketplace.listPurchases',
    );
    return rows.map(toPurchase);
  }

  /**
   * Creator upload: entryConfig is validated client-side via parseConfig
   * before inserting into `templates` (author_id = current user).
   */
  async uploadTemplate(input: CreatorUploadInput): Promise<TemplateMeta> {
    const authorId = await this.requireUserId();
    const parsed = parseConfig(input.entryConfig);
    if (!parsed.ok) {
      const issues = parsed.errors.map((e) => e.message).join('; ');
      throw new Error(`uploadTemplate: entryConfig failed validation: ${issues}`);
    }
    const row = await unwrap<TemplateRow>(
      this.client
        .from('templates')
        .insert({
          id: input.id,
          author_id: authorId,
          name: input.name,
          description: input.description,
          template_kind: input.templateKind,
          version: input.version,
          categories: input.categories,
          tags: input.tags,
          tier: input.tier,
          price_cents: input.priceCents ?? null,
          entry_config: parsed.config,
          thumbnail: input.thumbnail,
          engine_min_version: input.engineMinVersion,
        })
        .select()
        .single(),
      'uploadTemplate',
    );
    return toTemplateMeta(row);
  }
}

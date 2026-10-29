/**
 * MarketplacePanel — template browser over the real @lumen/app-marketplace:
 * TemplateCatalog (BuiltinSource ∪ PRICED_TEMPLATES ∪ CreatorSource)
 * search/filters, deterministic SVG thumbnails, detail modal,
 * Marketplace.install flows, checkUpdates badges, pro-tier gating via
 * @lumen/app-entitlements canAccessTemplate, paid-template purchases via
 * TemplatePurchases (MockTemplateBillingProvider) with revenue-share
 * recording, plus a Creator sub-panel (upload/edit own templates, generated
 * preview card, earnings + payout via RevenueShareLedger).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CATEGORIES,
  getPricedTemplate,
  isPaidTemplateMeta,
  type Category,
  type Marketplace,
  type TemplateMeta,
  type TemplatePrice,
  type TemplateTier,
  type TemplateUpdate,
} from '@lumen/app-marketplace';
import {
  USER_ID,
  entitlements,
  getMarketplace,
  ownsTemplate,
  reloadMarketplace,
  revenueLedger,
  telemetry,
  templatePurchases,
  canAccessTemplate,
} from '../platform/services';
import { usePlanId } from '../platform/hooks';
import { CreatorPanel } from './CreatorPanel';

export function formatPrice(price: TemplatePrice): string {
  return `${(price.amountCents / 100).toFixed(2)} ${price.currency.toUpperCase()}`;
}

function priceOf(meta: TemplateMeta): TemplatePrice | undefined {
  if (isPaidTemplateMeta(meta)) return meta.price;
  return getPricedTemplate(meta.id)?.price;
}

export function MarketplacePanel({ onInstalled }: { onInstalled?: () => void }) {
  const [marketplace, setMarketplace] = useState<Marketplace | null>(null);
  const [subView, setSubView] = useState<'browse' | 'creator'>('browse');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | ''>('');
  const [tier, setTier] = useState<TemplateTier | ''>('');
  const [tag, setTag] = useState('');
  const [detail, setDetail] = useState<TemplateMeta | null>(null);
  const [updates, setUpdates] = useState<TemplateUpdate[]>([]);
  const [installedIds, setInstalledIds] = useState<Record<string, string>>({});
  const [ownedIds, setOwnedIds] = useState<Record<string, boolean>>({});
  const [buying, setBuying] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const planId = usePlanId();

  const refreshMeta = useCallback((m: Marketplace) => {
    const map: Record<string, string> = {};
    for (const rec of m.installed.list()) map[rec.templateId] = rec.version;
    setInstalledIds(map);
    setUpdates(m.checkUpdates());
    const owned: Record<string, boolean> = {};
    for (const p of templatePurchases.purchases.listByUser(USER_ID)) {
      owned[p.templateId] = true;
    }
    setOwnedIds(owned);
  }, []);

  useEffect(() => {
    void getMarketplace().then((m) => {
      setMarketplace(m);
      refreshMeta(m);
    });
  }, [refreshMeta]);

  const results = useMemo(() => {
    if (!marketplace) return [];
    return marketplace.templates.search(query, {
      category: category || undefined,
      tier: tier || undefined,
      tags: tag.trim() ? [tag.trim().toLowerCase()] : undefined,
    });
  }, [marketplace, query, category, tier, tag]);

  const allTags = useMemo(() => {
    if (!marketplace) return [];
    const tags = new Set<string>();
    marketplace.templates.list().forEach((t) => t.tags.forEach((x) => tags.add(x)));
    return [...tags].sort();
  }, [marketplace]);

  /** Real gating seam: tier gate + paid ownership, non-throwing. */
  const canAccess = (meta: TemplateMeta): boolean =>
    canAccessTemplate(entitlements, USER_ID, meta, ownsTemplate);

  const install = async (meta: TemplateMeta) => {
    if (!marketplace) return;
    setError(null);
    setNotice(null);
    if (!canAccess(meta)) {
      setError(
        `"${meta.name}" is locked: it requires the pro plan or a template purchase (see the Buy button).`,
      );
      return;
    }
    try {
      marketplace.install(meta.id);
      telemetry.track('builder.template.installed', {
        templateId: meta.id,
        version: meta.version,
        tier: meta.tier,
      });
      refreshMeta(marketplace);
      setNotice(`Installed ${meta.name} v${meta.version} — it now appears in the wizard's template picker.`);
      onInstalled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const buy = async (meta: TemplateMeta) => {
    setError(null);
    setNotice(null);
    setBuying(meta.id);
    try {
      const purchase = await templatePurchases.purchaseTemplate(USER_ID, meta.id);
      revenueLedger.recordPurchase({
        purchaseId: purchase.id,
        authorId: purchase.authorId,
        amountCents: purchase.amountCents,
      });
      telemetry.track('builder.template.purchased', {
        templateId: meta.id,
        amountCents: purchase.amountCents,
        currency: purchase.currency,
      });
      if (marketplace) refreshMeta(marketplace);
      setNotice(
        `Purchased "${meta.name}" for ${formatPrice({
          amountCents: purchase.amountCents,
          currency: purchase.currency,
        })} — paid installs are now unlocked.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuying(null);
    }
  };

  if (!marketplace) {
    return <div className="p-8 text-sm text-ink-400">Loading the template catalog…</div>;
  }

  const updateFor = (id: string) => updates.find((u) => u.templateId === id);

  const renderCard = (meta: TemplateMeta) => {
    const price = priceOf(meta);
    const owned = Boolean(ownedIds[meta.id]);
    const locked = !canAccess(meta);
    const installed = installedIds[meta.id];
    const update = updateFor(meta.id);
    return (
      <div key={meta.id} className="card flex flex-col gap-2">
        <button className="text-left" onClick={() => setDetail(meta)}>
          <img
            src={meta.thumbnail}
            alt={meta.name}
            className="w-full h-32 object-cover rounded border border-ink-800"
          />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-sm text-ink-100">{meta.name}</span>
            {meta.tier === 'pro' && (
              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-amber-900 text-amber-300">
                pro
              </span>
            )}
            {price && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-accent/40 text-accent">
                {formatPrice(price)}
              </span>
            )}
            {owned && (
              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-emerald-900 text-emerald-300">
                owned
              </span>
            )}
            {locked && (
              <span
                className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-ink-600 text-ink-400"
                title="Locked — pro plan or purchase required"
              >
                locked
              </span>
            )}
            {update && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-accent/40 text-accent">
                update {update.installedVersion} → {update.availableVersion}
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono text-ink-400 mt-0.5">
            v{meta.version} · {meta.categories.join(', ')} · by {meta.author}
          </div>
          <p className="text-xs text-ink-300 mt-1 line-clamp-2">{meta.description}</p>
        </button>
        <div className="mt-auto flex items-center gap-2 flex-wrap">
          <button className="btn text-xs" onClick={() => setDetail(meta)}>
            Details
          </button>
          {price && !owned && (
            <button
              className="btn-primary text-xs disabled:opacity-40"
              disabled={buying === meta.id}
              onClick={() => void buy(meta)}
            >
              {buying === meta.id ? 'Charging…' : `Buy ${formatPrice(price)}`}
            </button>
          )}
          <button
            className="btn-primary text-xs disabled:opacity-40"
            disabled={locked}
            title={locked ? 'Pro plan or purchase required' : undefined}
            onClick={() => void install(meta)}
          >
            {installed ? (update ? 'Update' : 'Reinstall') : 'Install'}
          </button>
          {installed && (
            <span className="text-[9px] font-mono text-emerald-300">installed v{installed}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-5 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="section-title mb-0">Marketplace</h2>
        <div className="flex items-center gap-1">
          {(['browse', 'creator'] as const).map((v) => (
            <button
              key={v}
              className={`px-2.5 py-1 rounded text-[11px] uppercase tracking-wider ${
                subView === v
                  ? 'bg-ink-800 text-ink-100 border border-ink-600'
                  : 'text-ink-400 hover:text-ink-200'
              }`}
              onClick={() => setSubView(v)}
            >
              {v === 'browse' ? 'Browse' : 'Creator'}
            </button>
          ))}
        </div>
        {subView === 'browse' && (
          <>
            <input
              className="flex-1 min-w-48"
              placeholder="Search name, description, tags…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={category} onChange={(e) => setCategory(e.target.value as Category | '')}>
              <option value="">all categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select value={tier} onChange={(e) => setTier(e.target.value as TemplateTier | '')}>
              <option value="">all tiers</option>
              <option value="free">free</option>
              <option value="pro">pro</option>
            </select>
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">all tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
            <span className="text-[10px] font-mono text-ink-400">
              plan: {planId} · {results.length} template{results.length === 1 ? '' : 's'}
            </span>
          </>
        )}
      </div>

      {notice && (
        <div className="rounded border border-emerald-900 bg-ink-950 p-3 text-xs text-emerald-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded border border-red-900 bg-ink-950 p-3 text-xs text-red-200">
          {error}
        </div>
      )}

      {subView === 'creator' ? (
        <CreatorPanel
          onChanged={() => {
            void reloadMarketplace().then((m) => {
              setMarketplace(m);
              refreshMeta(m);
            });
          }}
          onNotice={setNotice}
          onError={setError}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
          {results.map(renderCard)}
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div
          className="fixed inset-0 bg-black/70 grid place-items-center z-50 p-6"
          onClick={() => setDetail(null)}
        >
          <div className="card max-w-lg w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <img
              src={detail.thumbnail}
              alt={detail.name}
              className="w-full h-44 object-cover rounded border border-ink-800"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg text-ink-100 font-semibold">{detail.name}</h3>
              {detail.tier === 'pro' && (
                <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-amber-900 text-amber-300">
                  pro
                </span>
              )}
              {priceOf(detail) && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-accent/40 text-accent">
                  {formatPrice(priceOf(detail)!)}
                </span>
              )}
            </div>
            <p className="text-sm text-ink-300">{detail.description}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-ink-400">id</dt>
              <dd className="font-mono text-ink-200">{detail.id}</dd>
              <dt className="text-ink-400">version</dt>
              <dd className="font-mono text-ink-200">{detail.version}</dd>
              <dt className="text-ink-400">template kind</dt>
              <dd className="font-mono text-ink-200">{detail.templateKind}</dd>
              <dt className="text-ink-400">author</dt>
              <dd className="font-mono text-ink-200">{detail.author}</dd>
              <dt className="text-ink-400">engine min</dt>
              <dd className="font-mono text-ink-200">{detail.engineMinVersion}</dd>
              <dt className="text-ink-400">scenes</dt>
              <dd className="font-mono text-ink-200">
                {detail.previewSceneCount ??
                  (detail.entryConfig as { scenes?: unknown[] }).scenes?.length ??
                  '—'}
              </dd>
              <dt className="text-ink-400">tags</dt>
              <dd className="font-mono text-ink-200">{detail.tags.map((t) => `#${t}`).join(' ')}</dd>
            </dl>
            <div className="flex gap-2 pt-1 flex-wrap">
              {priceOf(detail) && !ownedIds[detail.id] && (
                <button
                  className="btn-primary text-xs disabled:opacity-40"
                  disabled={buying === detail.id}
                  onClick={() => void buy(detail)}
                >
                  Buy {formatPrice(priceOf(detail)!)}
                </button>
              )}
              <button
                className="btn-primary text-xs disabled:opacity-40"
                disabled={!canAccess(detail)}
                onClick={() => {
                  void install(detail);
                  setDetail(null);
                }}
              >
                {installedIds[detail.id] ? 'Reinstall' : 'Install'}
              </button>
              <button className="btn text-xs" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

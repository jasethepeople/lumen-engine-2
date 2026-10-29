/**
 * tests/saas-smoke — (e) marketplace search → install (free) → purchase flow
 * for a priced template → revenue ledger 70/30.
 *
 * The facade's marketplace slot is an offline stub, so this exercises the
 * real @lumen/app-marketplace + @lumen/app-billing packages directly,
 * composed exactly the way the Builder wires them (BuiltinSource ∪ priced
 * source, MemoryInstalledTemplatesStore, MockTemplateBillingProvider —
 * the packages' own offline providers).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '@lumen/config';
import {
  BuiltinSource,
  Marketplace,
  MemoryInstalledTemplatesStore,
  MemoryPurchaseStore,
  MockTemplateBillingProvider,
  PRICED_TEMPLATES,
  TemplateCatalog,
  TemplatePurchases,
  getPricedTemplate,
} from '@lumen/app-marketplace';
import { RevenueShareLedger } from '@lumen/app-billing';

const fixedClock = () => 1_700_000_000_000;

async function loadCatalog() {
  return TemplateCatalog.load([
    new BuiltinSource(),
    { id: 'priced', fetchIndex: () => Promise.resolve([...PRICED_TEMPLATES]) },
  ]);
}

test('(e) search → install free template → real registry', async () => {
  const catalog = await loadCatalog();
  const results = catalog.search('cinema');
  assert.ok(results.some((t) => t.id === 'scroll-cinema-landing'));

  const market = new Marketplace(catalog, new MemoryInstalledTemplatesStore());
  const { registry, templateId } = market.install('scroll-cinema-landing');
  assert.equal(templateId, 'scroll-cinema-landing');
  // The returned registry is real: it composes the template's entryConfig.
  const meta = catalog.getById(templateId);
  assert.ok(parseConfig(meta.entryConfig).ok);
  const descriptor = registry.require(meta.templateKind);
  assert.equal(descriptor.version, '1.0.0');
  const record = market.installed.get(templateId);
  assert.equal(record.version, '1.0.0');
});

test('(e) priced template purchase → 70/30 revenue ledger', async () => {
  assert.ok(PRICED_TEMPLATES.length >= 2, 'priced builtins exist');
  const target = PRICED_TEMPLATES[0];
  assert.equal(getPricedTemplate(target.id).id, target.id);

  const purchases = new TemplatePurchases(
    new MemoryPurchaseStore(),
    new MockTemplateBillingProvider(fixedClock),
    fixedClock,
  );
  assert.equal(purchases.ownsTemplate('buyer-1', target.id), false);

  const purchase = await purchases.purchaseTemplate('buyer-1', target.id);
  assert.equal(purchase.userId, 'buyer-1');
  assert.equal(purchase.templateId, target.id);
  assert.equal(purchase.amountCents, target.price.amountCents);
  assert.equal(purchase.authorId, target.author);
  assert.equal(purchases.ownsTemplate('buyer-1', target.id), true);
  assert.equal(purchases.ownsTemplate('buyer-2', target.id), false);

  // Idempotent repeat purchase: one record, one charge.
  const again = await purchases.purchaseTemplate('buyer-1', target.id);
  assert.deepEqual(again, purchase);
  assert.equal(purchases.purchases.list().length, 1);

  // Revenue ledger: creator 70% (rounded), platform remainder, exact sum.
  const ledger = new RevenueShareLedger(fixedClock);
  const entry = ledger.recordPurchase({
    purchaseId: purchase.id,
    authorId: purchase.authorId,
    amountCents: purchase.amountCents,
  });
  assert.equal(entry.creatorShareCents, Math.round(purchase.amountCents * 0.7));
  assert.equal(
    entry.platformShareCents,
    purchase.amountCents - entry.creatorShareCents,
  );
  assert.equal(entry.creatorShareCents + entry.platformShareCents, purchase.amountCents);
  assert.equal(ledger.creatorEarnings(purchase.authorId), entry.creatorShareCents);
  assert.equal(ledger.platformRevenue(), entry.platformShareCents);
});

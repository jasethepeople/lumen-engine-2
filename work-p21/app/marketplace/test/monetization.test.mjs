/**
 * @lumen/app-marketplace — Phase 15 monetization tests.
 *
 * Covers: paid template guard/codec + PRICED_TEMPLATES validity, purchase
 * lifecycle + ownership, creator upload validation failures + success,
 * updateMeta ownership enforcement, and the deterministic preview generator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '@lumen/config';
import {
  CreatorOwnershipError,
  CreatorTemplateService,
  CreatorTemplateValidationError,
  MemoryPurchaseStore,
  MockTemplateBillingProvider,
  PRICED_TEMPLATES,
  PurchaseError,
  TemplateCatalog,
  TemplatePurchases,
  getPricedTemplate,
  isPaidTemplateMeta,
  withPrice,
} from '../dist/index.js';
import { BUILTIN_TEMPLATES } from '../dist/index.js';

const fixedClock = () => 1_700_000_000_000;

/** Minimal valid entryConfig for creator uploads. */
function validEntryConfig(id) {
  return {
    version: 3,
    id,
    template: 'cinematic-spa',
    meta: { title: 'Creator Piece', description: 'A creator-made template.', locale: 'en' },
    theme: { colors: { background: '#000', foreground: '#fff', accent: '#abc' } },
    assets: [],
    scenes: [
      {
        id: 'title-card',
        slot: 'title-card',
        nodes: [{ id: 'title', kind: 'dom', html: '<h1>Hi</h1>' }],
        track: { driver: 'time', durationOrRange: 4 },
        a11y: { label: 'Title' },
      },
      {
        id: 'act-1',
        slot: 'acts',
        nodes: [{ id: 'body', kind: 'dom', html: '<p>Body</p>' }],
        track: { driver: 'scroll', durationOrRange: 6 },
        a11y: { label: 'Act' },
      },
    ],
    interactions: [],
    build: { target: 'static', ssr: true, minify: false },
  };
}

function validInput(id) {
  return {
    id,
    name: 'Creator Piece',
    description: 'A creator-made template.',
    templateKind: 'cinematic-spa',
    version: '1.0.0',
    categories: ['portfolio'],
    tags: ['creator'],
    tier: 'free',
    engineMinVersion: '0.1.0',
  };
}

/* --- paid metadata -------------------------------------------------------- */

test('isPaidTemplateMeta guard and withPrice codec', () => {
  const free = BUILTIN_TEMPLATES.find((t) => t.tier === 'free');
  assert.equal(isPaidTemplateMeta(free), false);
  const paid = withPrice(free, { amountCents: 500, currency: 'USD' });
  assert.equal(isPaidTemplateMeta(paid), true);
  assert.equal(paid.price.amountCents, 500);
  assert.throws(() => withPrice(free, { amountCents: -1, currency: 'USD' }));
  assert.throws(() => withPrice(free, { amountCents: 1.5, currency: 'USD' }));
  assert.throws(() => withPrice(free, { amountCents: 100, currency: 'usd' }));
  assert.equal(
    isPaidTemplateMeta({ ...free, price: { amountCents: 1.2, currency: 'USD' } }),
    false,
  );
});

test('PRICED_TEMPLATES are well-formed and their entryConfigs parse', () => {
  assert.ok(PRICED_TEMPLATES.length >= 2);
  for (const t of PRICED_TEMPLATES) {
    assert.equal(isPaidTemplateMeta(t), true);
    assert.ok(t.price.amountCents > 0);
    const parsed = parseConfig(t.entryConfig);
    assert.ok(parsed.ok, `entryConfig for '${t.id}' must parse: ${JSON.stringify(parsed)}`);
  }
  assert.equal(getPricedTemplate(PRICED_TEMPLATES[0].id)?.id, PRICED_TEMPLATES[0].id);
  assert.equal(getPricedTemplate('nope'), undefined);
});

/* --- purchase lifecycle --------------------------------------------------- */

test('purchase lifecycle: charge, record, ownership, idempotency', async () => {
  const purchases = new TemplatePurchases(
    new MemoryPurchaseStore(),
    new MockTemplateBillingProvider(fixedClock),
    fixedClock,
  );
  const target = PRICED_TEMPLATES[0];
  assert.equal(purchases.ownsTemplate('u1', target.id), false);

  const purchase = await purchases.purchaseTemplate('u1', target.id);
  assert.equal(purchase.userId, 'u1');
  assert.equal(purchase.templateId, target.id);
  assert.equal(purchase.amountCents, target.price.amountCents);
  assert.equal(purchase.currency, target.price.currency);
  assert.equal(purchase.authorId, target.author);
  assert.equal(purchase.purchasedAt, 1_700_000_000_000);
  assert.ok(purchase.id.startsWith('purchase_mock_charge_'));

  assert.equal(purchases.ownsTemplate('u1', target.id), true);
  assert.equal(purchases.ownsTemplate('u2', target.id), false);

  // Repeat purchase is idempotent: same record, no extra charge/entry.
  const again = await purchases.purchaseTemplate('u1', target.id);
  assert.deepEqual(again, purchase);
  assert.equal(purchases.purchases.list().length, 1);
});

test('purchase rejects unknown and free templates without recording', async () => {
  const purchases = new TemplatePurchases(
    new MemoryPurchaseStore(),
    new MockTemplateBillingProvider(fixedClock),
    fixedClock,
    (id) => BUILTIN_TEMPLATES.find((t) => t.id === id),
  );
  await assert.rejects(() => purchases.purchaseTemplate('u1', 'missing'), PurchaseError);
  const free = BUILTIN_TEMPLATES.find((t) => t.tier === 'free');
  await assert.rejects(() => purchases.purchaseTemplate('u1', free.id), PurchaseError);
  assert.equal(purchases.purchases.list().length, 0);
  assert.equal(purchases.ownsTemplate('u1', free.id), false);
});

/* --- creator templates ---------------------------------------------------- */

test('creator upload: validation failures', () => {
  const svc = new CreatorTemplateService();
  // Bad entryConfig (fails parseConfig).
  assert.throws(
    () => svc.uploadTemplate('alice', validInput('piece-1'), { version: 3 }),
    (err) => err instanceof CreatorTemplateValidationError && err.issues.length > 0,
  );
  // Bad version (semver check).
  assert.throws(
    () =>
      svc.uploadTemplate('alice', { ...validInput('piece-2'), version: '1.0' }, validEntryConfig('piece-2')),
    CreatorTemplateValidationError,
  );
  // Bad engineMinVersion.
  assert.throws(
    () =>
      svc.uploadTemplate(
        'alice',
        { ...validInput('piece-3'), engineMinVersion: 'x' },
        validEntryConfig('piece-3'),
      ),
    CreatorTemplateValidationError,
  );
  // Empty authorId.
  assert.throws(
    () => svc.uploadTemplate('', validInput('piece-4'), validEntryConfig('piece-4')),
    CreatorTemplateValidationError,
  );
  // Nothing was stored.
  assert.equal(svc.source.id, 'creator');
});

test('creator upload: success flows into a catalog via CreatorSource', async () => {
  const svc = new CreatorTemplateService();
  const record = svc.uploadTemplate('alice', validInput('piece-1'), validEntryConfig('piece-1'));
  assert.equal(record.authorId, 'alice');
  assert.equal(record.meta.author, 'alice');
  assert.ok(record.meta.thumbnail.startsWith('data:image/svg+xml,'));

  // Duplicate id rejected.
  assert.throws(
    () => svc.uploadTemplate('bob', validInput('piece-1'), validEntryConfig('piece-1')),
    CreatorTemplateValidationError,
  );

  const catalog = await TemplateCatalog.load([svc.source]);
  const meta = catalog.getById('piece-1');
  assert.ok(meta, 'creator template must appear in the catalog');
  assert.equal(meta.author, 'alice');
});

test('updateMeta: ownership enforcement + revalidation', () => {
  const svc = new CreatorTemplateService();
  svc.uploadTemplate('alice', validInput('piece-1'), validEntryConfig('piece-1'));

  // Non-owner cannot edit.
  assert.throws(
    () => svc.updateMeta('piece-1', 'bob', { name: 'Hijacked' }),
    CreatorOwnershipError,
  );

  // Owner edits; invalid patch rejected and not stored.
  assert.throws(
    () => svc.updateMeta('piece-1', 'alice', { version: 'not-semver' }),
    CreatorTemplateValidationError,
  );
  const updated = svc.updateMeta('piece-1', 'alice', {
    name: 'Renamed',
    version: '1.1.0',
    tags: ['creator', 'updated'],
  });
  assert.equal(updated.meta.name, 'Renamed');
  assert.equal(updated.meta.version, '1.1.0');
  assert.deepEqual(updated.meta.tags, ['creator', 'updated']);
  assert.equal(updated.meta.id, 'piece-1');
  assert.equal(updated.authorId, 'alice');

  // Unknown template.
  assert.throws(
    () => svc.updateMeta('ghost', 'alice', { name: 'X' }),
    CreatorTemplateValidationError,
  );
});

/* --- preview generator ---------------------------------------------------- */

test('generatePreview: deterministic descriptor from entryConfig', () => {
  const svc = new CreatorTemplateService();
  svc.uploadTemplate('alice', validInput('piece-1'), validEntryConfig('piece-1'));
  const preview = svc.generatePreview('piece-1');
  assert.equal(preview.sceneCount, 2);
  // durations: 4 + 6 = 10
  assert.equal(preview.estimatedDuration, 10);
  assert.ok(preview.thumbnail.startsWith('data:image/svg+xml,'));
  // Deterministic.
  assert.deepEqual(preview, svc.generatePreview('piece-1'));
  // Unknown template.
  assert.throws(() => svc.generatePreview('ghost'), CreatorTemplateValidationError);
});

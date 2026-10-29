/**
 * @lumen/app-marketplace — headless tests.
 *
 * Covers: catalog integrity (every BuiltinSource entryConfig passes
 * parseConfig from @lumen/config), search ranking and filters, install
 * round-trip through createExtendedRegistry, update detection, and both
 * InstalledTemplatesStore adapters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '@lumen/config';
import {
  cinematicStoryTemplate,
  createDefaultRegistry,
  createExtendedRegistry,
  productShowcaseTemplate,
  scrollCinemaLandingTemplate,
} from '@lumen/templates';
import {
  BUILTIN_TEMPLATES,
  BuiltinSource,
  LocalStorageInstalledTemplatesStore,
  Marketplace,
  MemoryInstalledTemplatesStore,
  TemplateCatalog,
  TemplateValidationError,
  compareSemver,
  makeThumbnail,
  validateTemplateMeta,
} from '../dist/index.js';

async function loadCatalog() {
  return TemplateCatalog.load([new BuiltinSource()]);
}

/* --- Catalog integrity ---------------------------------------------------- */

test('builtin catalog loads with the expected entries', async () => {
  const catalog = await loadCatalog();
  const ids = catalog.list().map((t) => t.id);
  assert.deepEqual(ids, [
    'aurora-summit',
    'cinematic-story',
    'folio-mono',
    'prism-lab',
    'product-showcase',
    'scroll-cinema-landing',
  ]);
});

test('every BuiltinSource entryConfig passes parseConfig', async () => {
  const catalog = await loadCatalog();
  for (const meta of catalog.list()) {
    const result = parseConfig(meta.entryConfig);
    assert.ok(
      result.ok,
      `${meta.id}: entryConfig must parse — ${result.ok ? '' : JSON.stringify(result.errors)}`,
    );
    assert.equal(result.config.template, meta.templateKind);
  }
});

test('templateKind matches the kind declared in each specialization source', async () => {
  const catalog = await loadCatalog();
  const extended = createExtendedRegistry();
  const expected = {
    'scroll-cinema-landing': ['scroll-video', scrollCinemaLandingTemplate],
    'cinematic-story': ['cinematic-spa', cinematicStoryTemplate],
    'product-showcase': ['viewer-3d', productShowcaseTemplate],
  };
  for (const [id, [kind, descriptor]] of Object.entries(expected)) {
    const meta = catalog.getById(id);
    assert.equal(meta.templateKind, kind);
    // The extended registry's descriptor for that kind IS the specialization.
    assert.equal(extended.require(kind), descriptor);
  }
});

test('all metadata is well-formed (semver, categories, thumbnails)', async () => {
  const catalog = await loadCatalog();
  for (const meta of catalog.list()) {
    assert.deepEqual(validateTemplateMeta(meta), [], meta.id);
    assert.ok(meta.thumbnail.startsWith('data:image/svg+xml,'));
  }
  assert.equal(BUILTIN_TEMPLATES.length, catalog.list().length);
});

test('thumbnails are deterministic from id', () => {
  assert.equal(makeThumbnail('folio-mono'), makeThumbnail('folio-mono'));
  assert.notEqual(makeThumbnail('folio-mono'), makeThumbnail('prism-lab'));
});

/* --- Search / filters ----------------------------------------------------- */

test('search is case-insensitive and ranks exact tag > name > description', async () => {
  const catalog = await loadCatalog();
  // 'cinematic' is an exact tag of all three; Cinematic Story also matches
  // on name, Scroll Cinema Landing on description — exact tag + name (140)
  // > exact tag + description (120) > exact tag alone (100).
  const results = catalog.search('CiNeMaTiC');
  const ids = results.map((t) => t.id);
  assert.deepEqual(ids, ['cinematic-story', 'scroll-cinema-landing', 'aurora-summit']);
  // Name-only match outranks description-only match.
  const byName = catalog.search('prism');
  assert.deepEqual(byName.map((t) => t.id), ['prism-lab']);
});

test('search with empty query returns everything (sorted by id)', async () => {
  const catalog = await loadCatalog();
  assert.equal(catalog.search('').length, 6);
  assert.equal(catalog.search('   ').length, 6);
});

test('search filters by category, tier and tags', async () => {
  const catalog = await loadCatalog();
  assert.deepEqual(
    catalog.search('', { category: 'event' }).map((t) => t.id),
    ['aurora-summit'],
  );
  assert.deepEqual(
    catalog.search('', { tier: 'pro' }).map((t) => t.id),
    ['aurora-summit', 'folio-mono', 'prism-lab'],
  );
  assert.deepEqual(
    catalog.search('', { tags: ['3d', 'webgl'] }).map((t) => t.id),
    ['prism-lab', 'product-showcase'],
  );
  // Combined filters.
  assert.deepEqual(
    catalog.search('viewer', { tier: 'pro' }).map((t) => t.id),
    ['prism-lab'],
  );
  // No match.
  assert.deepEqual(catalog.search('nonexistent-xyz'), []);
});

test('getById and listCategories', async () => {
  const catalog = await loadCatalog();
  assert.equal(catalog.getById('folio-mono').name, 'Folio Mono');
  assert.equal(catalog.getById('missing'), undefined);
  assert.deepEqual(catalog.listCategories(), [
    { category: 'landing', count: 1 },
    { category: 'storytelling', count: 1 },
    { category: 'product', count: 2 },
    { category: 'portfolio', count: 1 },
    { category: 'event', count: 1 },
    { category: 'experimental', count: 1 },
  ]);
});

test('pluggable sources merge into the catalog', async () => {
  const extra = {
    id: 'custom-source',
    async fetchIndex() {
      return [
        {
          ...BUILTIN_TEMPLATES[0],
          id: 'community-grid',
          name: 'Community Grid',
          version: '0.0.1',
        },
      ];
    },
  };
  const catalog = await TemplateCatalog.load([new BuiltinSource(), extra]);
  assert.equal(catalog.list().length, 7);
  assert.equal(catalog.getById('community-grid').name, 'Community Grid');
});

/* --- Install / updates ---------------------------------------------------- */

test('install validates, specializes via the extended-registry seam, and records', async () => {
  const catalog = await loadCatalog();
  const store = new MemoryInstalledTemplatesStore();
  const market = new Marketplace(catalog, store, () => 1_700_000_000_000);
  const { registry, templateId } = market.install('scroll-cinema-landing');
  assert.equal(templateId, 'scroll-cinema-landing');
  // The composed registry still serves the frozen kind, now versioned by the
  // marketplace template, and can compose the entryConfig's scene.
  const descriptor = registry.require('scroll-video');
  assert.equal(descriptor.version, '1.0.0');
  assert.equal(descriptor.compose, scrollCinemaLandingTemplate.compose);
  const record = store.get('scroll-cinema-landing');
  assert.equal(record.version, '1.0.0');
  assert.equal(record.installedAt, 1_700_000_000_000);
});

test('install round-trip: returned registry composes the entryConfig', async () => {
  const catalog = await loadCatalog();
  const market = new Marketplace(catalog);
  const meta = catalog.getById('product-showcase');
  const { registry } = market.install('product-showcase');
  const parsed = parseConfig(meta.entryConfig);
  assert.ok(parsed.ok);
  const composed = registry.require('viewer-3d').compose(parsed.config, { assets: {} });
  assert.ok(composed.sceneGraph.length > 0);
  assert.ok(composed.tracks.length > 0);
});

test('install accepts a caller-provided registry and never mutates createDefaultRegistry', async () => {
  const catalog = await loadCatalog();
  const market = new Marketplace(catalog);
  const target = createDefaultRegistry();
  const before = target.require('scroll-video').version;
  market.install('scroll-cinema-landing', target);
  assert.equal(target.require('scroll-video').version, '1.0.0');
  // A fresh default registry is untouched.
  assert.equal(createDefaultRegistry().require('scroll-video').version, before);
});

test('install rejects unknown and invalid templates', async () => {
  const catalog = await loadCatalog();
  const market = new Marketplace(catalog);
  assert.throws(() => market.install('nope'), TemplateValidationError);
  // Corrupt a catalog entry in place: invalid entryConfig must fail validation.
  const bad = catalog.getById('folio-mono');
  bad.entryConfig = { garbage: true };
  assert.throws(() => market.install('folio-mono'), (err) => {
    assert.ok(err instanceof TemplateValidationError);
    assert.ok(err.issues.length > 0);
    return true;
  });
  assert.equal(market.installed.get('folio-mono'), undefined);
});

test('checkUpdates detects newer catalog versions', async () => {
  const catalog = await loadCatalog();
  const store = new MemoryInstalledTemplatesStore();
  const market = new Marketplace(catalog, store);
  market.install('aurora-summit'); // catalog version 0.2.0
  assert.deepEqual(market.checkUpdates(), []);
  // Simulate an older install + a newer catalog release.
  store.set({ templateId: 'aurora-summit', version: '0.1.0', installedAt: 1 });
  assert.deepEqual(market.checkUpdates(), [
    { templateId: 'aurora-summit', installedVersion: '0.1.0', availableVersion: '0.2.0' },
  ]);
  // A newer installed version is not an update.
  store.set({ templateId: 'aurora-summit', version: '9.9.9', installedAt: 1 });
  assert.deepEqual(market.checkUpdates(), []);
  // Installed templates no longer in the catalog are ignored.
  store.set({ templateId: 'ghost', version: '0.0.1', installedAt: 1 });
  assert.deepEqual(market.checkUpdates(), []);
});

test('compareSemver orders releases', () => {
  assert.ok(compareSemver('0.1.0', '0.2.0') < 0);
  assert.ok(compareSemver('1.0.0', '0.9.9') > 0);
  assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
  assert.ok(compareSemver('1.0.0-alpha', '1.0.0') < 0);
  assert.equal(compareSemver('1.0.0+build1', '1.0.0'), 0);
  assert.ok(compareSemver('0.10.0', '0.9.0') > 0);
  assert.throws(() => compareSemver('1.0', '1.0.0'));
});

/* --- Store adapters ------------------------------------------------------- */

test('MemoryInstalledTemplatesStore round-trips records', () => {
  const store = new MemoryInstalledTemplatesStore();
  store.set({ templateId: 'b', version: '1.0.0', installedAt: 2 });
  store.set({ templateId: 'a', version: '0.1.0', installedAt: 1 });
  assert.deepEqual(store.get('a'), { templateId: 'a', version: '0.1.0', installedAt: 1 });
  assert.deepEqual(
    store.list().map((r) => r.templateId),
    ['a', 'b'],
  );
  store.set({ templateId: 'a', version: '0.2.0', installedAt: 3 });
  assert.equal(store.get('a').version, '0.2.0');
  store.remove('a');
  assert.equal(store.get('a'), undefined);
});

function makeFakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

test('LocalStorageInstalledTemplatesStore persists across instances', () => {
  const storage = makeFakeStorage();
  const a = new LocalStorageInstalledTemplatesStore(storage);
  a.set({ templateId: 'prism-lab', version: '0.1.0', installedAt: 42 });
  const b = new LocalStorageInstalledTemplatesStore(storage);
  assert.deepEqual(b.get('prism-lab'), { templateId: 'prism-lab', version: '0.1.0', installedAt: 42 });
  b.remove('prism-lab');
  assert.deepEqual(new LocalStorageInstalledTemplatesStore(storage).list(), []);
});

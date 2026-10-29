import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preload, buildQueue, PreloadPauser } from '../dist/preload.js';
import { normalizeManifest } from '../dist/manifest.js';
import { AssetManager } from '../dist/manager.js';
import { FIXTURE_MANIFEST } from './fixtures.mjs';

/** Fake fetch: counts concurrent in-flight requests, resolves after `delay` ms. */
function makeTrackingFetch(delay = 20) {
  let inFlight = 0;
  let maxInFlight = 0;
  const started = [];
  const fetchImpl = async (url) => {
    started.push(String(url));
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, delay));
    inFlight -= 1;
    const body = new TextEncoder().encode(`bytes:${url}`);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => body.buffer,
      json: async () => ({ url: String(url) }),
    };
  };
  return { fetchImpl, stats: () => ({ maxInFlight, started }) };
}

/** Manifest of N image assets with mixed priorities. */
function imageManifest(n, preloads) {
  const assets = {};
  for (let i = 0; i < n; i += 1) {
    assets[`img${i}`] = {
      kind: 'image',
      preload: preloads?.[i] ?? 'eager',
      bytes: 10,
      width: 4,
      height: 4,
      variants: { fallback: { url: `/assets/hash${i}/img${i}.png`, mime: 'image/png' } },
    };
  }
  return normalizeManifest({ version: 1, generatedAt: '2026-01-01T00:00:00.000Z', assets });
}

test('preload respects the concurrency limit', async () => {
  const manifest = imageManifest(8);
  const { fetchImpl, stats } = makeTrackingFetch(25);
  const results = await preload(buildQueue(manifest), { concurrency: 3, fetchImpl });
  assert.equal(results.length, 8);
  assert.ok(results.every((r) => r.status === 'ready'));
  assert.ok(stats().maxInFlight <= 3, `max concurrency ${stats().maxInFlight} <= 3`);
  assert.ok(stats().maxInFlight >= 2, 'pool actually parallelizes');
});

test('preload starts critical assets before lazy ones', async () => {
  const manifest = imageManifest(4, ['lazy', 'lazy', 'critical', 'eager']);
  const { fetchImpl, stats } = makeTrackingFetch(15);
  await preload(buildQueue(manifest), { concurrency: 2, fetchImpl });
  assert.equal(stats().started[0], '/assets/hash2/img2.png'); // the critical one
});

test('preload aggregates progress with asset:progress payloads', async () => {
  const manifest = imageManifest(3);
  const { fetchImpl } = makeTrackingFetch(5);
  const events = [];
  await preload(buildQueue(manifest), { concurrency: 2, fetchImpl, emit: (p) => events.push(p) });
  assert.deepEqual(events[0], { loaded: 0, total: 3 });
  assert.equal(events.length, 4);
  assert.equal(events.at(-1).loaded, 3);
  assert.ok(events.at(-1).assetId);
  // loaded is monotonically increasing
  for (let i = 1; i < events.length; i += 1) {
    assert.equal(events[i].loaded, events[i - 1].loaded + 1);
  }
});

test('individual asset failure does not fail the run', async () => {
  const manifest = imageManifest(3);
  const fetchImpl = async (url) => {
    if (String(url).includes('img1')) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const body = new TextEncoder().encode('x');
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer, json: async () => ({}) };
  };
  const results = await preload(buildQueue(manifest), { concurrency: 2, fetchImpl });
  const byId = new Map(results.map((r) => [r.id, r]));
  assert.equal(byId.get('img1').status, 'error');
  assert.match(byId.get('img1').error.message, /HTTP 404/);
  assert.equal(byId.get('img0').status, 'ready');
  assert.equal(byId.get('img2').status, 'ready');
});

test('abort stops the run and marks unfinished entries', async () => {
  const manifest = imageManifest(6);
  const { fetchImpl } = makeTrackingFetch(50);
  const controller = new AbortController();
  const run = preload(buildQueue(manifest), { concurrency: 1, fetchImpl, signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  const results = await run;
  assert.ok(results.length === 6);
  assert.ok(results.some((r) => r.status === 'error' && r.error.name === 'AbortError'));
});

test('AssetManager facade: init, preload, get, stats, dispose', async () => {
  const manifest = structuredClone(FIXTURE_MANIFEST);
  delete manifest.assets.intro; // video requires a DOM; excluded from Node run
  const manager = new AssetManager();
  const events = [];
  const { fetchImpl } = makeTrackingFetch(5);
  manager.init(manifest, {
    cdnBase: 'https://cdn.example.com',
    fetchImpl,
    emit: (p) => events.push(p),
  });
  assert.equal(manager.stats().total, 5);

  const results = await manager.preload(['hero', 'logo']);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.status === 'ready'));

  const hero = manager.get('hero');
  assert.equal(hero.kind, 'image');
  assert.equal(hero.bitmap, null); // no createImageBitmap under Node — guarded
  assert.equal(new TextDecoder().decode(hero.bytes).startsWith('bytes:'), true);
  assert.equal(manager.get('missing'), undefined);
  assert.equal(manager.state('hero'), 'ready');
  assert.equal(manager.state('theme'), 'queued');

  const stats = manager.stats();
  assert.equal(stats.ready, 2);
  assert.equal(events[0].total, 2);

  assert.equal(manager.resolveUrl('logo'), 'https://cdn.example.com/assets/dddd4444/logo.json');

  await manager.cachePayload('hero', new ArrayBuffer(8));
  assert.equal(manager.stats().cacheEntries >= 1, true);

  await manager.dispose();
  assert.equal(manager.getManifest(), null);
  assert.equal(manager.get('hero'), undefined);
});

test('AssetManager video asset reports a guarded environment error in Node', async () => {
  const manager = new AssetManager();
  manager.init(FIXTURE_MANIFEST, { fetchImpl: makeTrackingFetch(1).fetchImpl });
  const results = await manager.preload(['intro']);
  assert.equal(results[0].status, 'error');
  assert.equal(results[0].error.name, 'UnsupportedEnvironmentError');
  assert.equal(manager.state('intro'), 'error');
});

// --- P4: pause/resume of the preload queue driver ----------------------------

test('paused queue dequeues nothing; in-flight completes; resume continues in order', async () => {
  const manifest = imageManifest(4, ['critical', 'eager', 'eager', 'lazy']);
  const { fetchImpl, stats } = makeTrackingFetch();
  const pauser = new PreloadPauser();
  const queue = buildQueue(manifest);
  pauser.setPaused(true);
  const run = preload(queue, { concurrency: 2, fetchImpl, pauser });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stats().started.length, 0, 'nothing dequeued while paused');
  pauser.setPaused(false);
  const results = await run;
  assert.equal(results.filter((r) => r.status === 'ready').length, 4);
  assert.equal(stats().started[0], '/assets/hash0/img0.png', 'critical first after resume');
});

test('in-flight fetch completes while paused mid-run', async () => {
  const manifest = imageManifest(3, ['eager', 'eager', 'eager']);
  const { fetchImpl, stats } = makeTrackingFetch(15); // slow fetches
  const pauser = new PreloadPauser();
  const run = preload(buildQueue(manifest), { concurrency: 1, fetchImpl, pauser });
  await new Promise((r) => setTimeout(r, 5));
  pauser.setPaused(true); // first fetch in flight
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(stats().started.length, 1, 'no second fetch dequeued while paused');
  pauser.setPaused(false);
  const results = await run;
  assert.equal(results.filter((r) => r.status === 'ready').length, 3);
});

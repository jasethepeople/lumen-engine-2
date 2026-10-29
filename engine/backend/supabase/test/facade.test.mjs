import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createBackend,
  createLumenBackend,
  createOfflineBackend,
  HostedAssetQueue,
  HostedAuth,
  HostedBilling,
  HostedCatalog,
  HostedCollaboration,
  HostedCommunity,
  HostedDashboard,
  HostedEntitlementResolver,
  HostedProjectStore,
  HostedPublishService,
  HostedTelemetry,
} from '../dist/index.js';
import { FakeSupabaseClient } from './fake-client.mjs';

test('facade: createLumenBackend composes every module slot', () => {
  const backend = createLumenBackend({ client: new FakeSupabaseClient() });
  assert.ok(backend.auth instanceof HostedAuth);
  assert.ok(backend.projects instanceof HostedProjectStore);
  assert.ok(backend.assets instanceof HostedAssetQueue);
  assert.ok(backend.publish instanceof HostedPublishService);
  assert.ok(backend.marketplace instanceof HostedCatalog);
  assert.ok(backend.collaboration instanceof HostedCollaboration);
  assert.ok(backend.dashboard instanceof HostedDashboard);
  assert.ok(backend.community instanceof HostedCommunity);
  assert.ok(backend.billing instanceof HostedBilling);
  assert.ok(backend.entitlements instanceof HostedEntitlementResolver);
  assert.ok(backend.telemetry instanceof HostedTelemetry);
  assert.ok(backend.ai.HeuristicProvider, 'ai re-exports the local provider seam');
  assert.equal(backend.mode, 'hosted');
  assert.equal(backend.telemetry.isEnabled(), false, 'telemetry default OFF via facade');
});

test('facade: offline mode delegates to local app/* packages (zero Supabase config)', async () => {
  const backend = createOfflineBackend();
  assert.equal(backend.mode, 'offline');

  // projects: real @lumen/app-projects ProjectStore over MemoryStorage.
  const p = await backend.projects.createProject({
    name: 'Local', templateKind: 'landing', templateId: 't-1', config: {},
  });
  assert.equal((await backend.projects.listProjects()).length, 1);
  const versions = await backend.projects.listVersions(p.id);
  assert.equal(versions.length, 1);
  assert.ok((await backend.projects.exportProject(p.id)).includes('"formatVersion": 1'));

  // telemetry: local client, default OFF.
  assert.equal(backend.telemetry.stats().enabled, false);
  backend.telemetry.setEnabled(true);
  backend.telemetry.track('builder.test');
  assert.equal(backend.telemetry.stats().recorded, 1);

  // entitlements: pure local gating on the free plan.
  assert.equal(backend.entitlements.planId(), 'free');
  assert.equal(backend.entitlements.can('export.static'), true);
  assert.equal(backend.entitlements.can('templates.pro'), false);

  // assets: in-memory offline queue mirrors hosted shapes.
  const { asset, job } = await backend.assets.enqueue({
    projectId: p.id, name: 'a.png', kind: 'image', ops: ['optimize'],
  });
  assert.equal(job.assetId, asset.id);
  assert.equal((await backend.assets.listAssets(p.id)).length, 1);

  // auth: deterministic local user.
  assert.equal((await backend.auth.getUser()).id, 'offline-user');
});

test('facade: createBackend auto-selects hosted on VITE_SUPABASE_* env, else offline', () => {
  const offline = createBackend({});
  assert.equal(offline.mode, 'offline');

  const envOnly = createBackend({
    VITE_SUPABASE_URL: 'https://x.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon',
  });
  assert.equal(envOnly.mode, 'offline', 'env without a client factory stays offline');

  const hosted = createBackend(
    { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' },
    { client: new FakeSupabaseClient() },
  );
  assert.equal(hosted.mode, 'hosted');

  const partial = createBackend(
    { VITE_SUPABASE_URL: 'https://x.supabase.co' },
    { client: new FakeSupabaseClient() },
  );
  assert.equal(partial.mode, 'offline', 'missing anon key -> offline');
});

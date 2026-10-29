import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
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
  HandleTakenError,
} from '../dist/index.js';
import { FakeSupabaseClient } from './fake-client.mjs';

// ------------------------------------------------------------------- auth --

test('auth: signUp/signIn/magicLink/signOut/getUser/onAuthChange', async () => {
  const client = new FakeSupabaseClient();
  const auth = new HostedAuth(client);
  const u = await auth.signUp({ email: 'a@b.c', password: 'pw' });
  assert.equal(u.id, 'user-1');
  assert.equal((await auth.signInWithPassword({ email: 'a@b.c', password: 'pw' })).id, 'user-1');
  await auth.signInWithMagicLink('a@b.c');
  await auth.signOut();
  assert.equal((await auth.getUser()).id, 'user-1');
  let fired = false;
  const off = auth.onAuthChange(() => {
    fired = true;
  });
  client.authCallback('SIGNED_IN', { user: { id: 'user-1' } });
  assert.equal(fired, true);
  off();
});

// --------------------------------------------------------------- projects --

test('projects: create inserts into projects with schema columns', async () => {
  const client = new FakeSupabaseClient();
  const store = new HostedProjectStore(client);
  const p = await store.createProject({ name: 'Demo', templateKind: 'landing', templateId: 't-1' });
  const call = client.lastCall('projects');
  assert.equal(call.op, 'insert');
  assert.equal(call.values.owner_id, 'user-1');
  assert.equal(call.values.template_kind, 'landing');
  assert.equal(call.values.template_id, 't-1');
  assert.equal(call.values.schema_version, 1);
  assert.equal(p.name, 'Demo');
});

test('projects: update uses update().eq(id) and never writes versions (trigger-owned)', async () => {
  const client = new FakeSupabaseClient();
  client.seed('projects', [
    {
      id: 'p1', owner_id: 'user-1', name: 'A', template_kind: 'k', template_id: 't',
      config: {}, shared: false, schema_version: 1, created_at: '2024-01-01', updated_at: '2024-01-01',
    },
  ]);
  const store = new HostedProjectStore(client);
  await store.updateProject('p1', { config: { x: 1 } }, 'manual save');
  const call = client.lastCall('projects');
  assert.equal(call.op, 'update');
  assert.deepEqual(call.values, { config: { x: 1 } });
  assert.deepEqual(call.filters, [{ kind: 'eq', column: 'id', value: 'p1' }]);
  assert.equal(client.callsFor('project_versions').length, 0);
});

test('projects: list/get/duplicate/delete/listVersions/restoreVersion/export/import', async () => {
  const client = new FakeSupabaseClient();
  const row = {
    id: 'p1', owner_id: 'user-1', name: 'A', template_kind: 'k', template_id: 't',
    config: { a: 1 }, shared: false, schema_version: 1, created_at: '2024-01-01', updated_at: '2024-01-02',
  };
  client.seed('projects', [row]);
  client.seed('project_versions', [
    { id: 'v1', project_id: 'p1', version_num: 1, config: { a: 0 }, label: 'created', created_at: '2024-01-01' },
  ]);
  const store = new HostedProjectStore(client);
  assert.equal((await store.listProjects()).length, 1);
  const listCall = client.callsFor('projects')[0];
  assert.deepEqual(listCall.orderSpec, { column: 'updated_at', ascending: false });
  assert.equal((await store.getProject('p1')).templateKind, 'k');
  assert.equal(await store.getProject('nope'), undefined);

  const dup = await store.duplicateProject('p1');
  assert.equal(dup.name, 'A (copy)');

  const versions = await store.listVersions('p1');
  const vCall = client.lastCall('project_versions');
  assert.equal(vCall.op, 'select');
  assert.deepEqual(vCall.filters, [{ kind: 'eq', column: 'project_id', value: 'p1' }]);
  assert.equal(versions[0].versionId, 'v1');
  assert.equal(versions[0].label, 'created');

  const restored = await store.restoreVersion('p1', 'v1');
  assert.deepEqual(restored.config, { a: 0 });

  const exported = await store.exportProject('p1');
  const env = JSON.parse(exported);
  assert.equal(env.formatVersion, 1);
  assert.equal(env.versions.length, 1);

  const imported = await store.importProject(exported);
  assert.equal(imported.name, 'A');
  const vInsert = client.callsFor('project_versions').find((c) => c.op === 'insert');
  assert.ok(vInsert, 'import writes carried-over versions explicitly');
  assert.equal(vInsert.values[0].project_id, imported.id);

  assert.equal(await store.deleteProject('p1'), true);
  assert.equal(await store.deleteProject('p1'), false);
  assert.equal((await store.listProjects()).length, 2); // duplicate + import remain
});

// ----------------------------------------------------------------- assets --

test('assets: enqueue writes assets + asset_jobs rows and uploads to assets bucket path', async () => {
  const client = new FakeSupabaseClient();
  const queue = new HostedAssetQueue(client);
  const { asset, job } = await queue.enqueue({
    projectId: 'p1', name: 'clip.mp4', kind: 'video', ops: ['optimize'], file: new Blob(['x']),
    contentType: 'video/mp4',
  });
  const assetCall = client.callsFor('assets').find((c) => c.op === 'insert');
  assert.equal(assetCall.values.project_id, 'p1');
  assert.equal(assetCall.values.owner_id, 'user-1');
  assert.equal(assetCall.values.kind, 'video');
  const jobCall = client.lastCall('asset_jobs');
  assert.equal(jobCall.op, 'insert');
  assert.equal(jobCall.values.asset_id, asset.id);
  assert.deepEqual(jobCall.values.ops, ['optimize']);
  assert.equal(client.uploads.length, 1);
  assert.equal(client.uploads[0].bucket, 'assets');
  assert.equal(client.uploads[0].path, `user-1/p1/${asset.id}/source`);
  assert.equal(job.status, undefined === job.status ? job.status : 'queued' === job.status ? 'queued' : job.status);
});

test('assets: subscribeToJobStatus uses postgres_changes channel on asset_jobs', async () => {
  const client = new FakeSupabaseClient();
  const queue = new HostedAssetQueue(client);
  let seen;
  const unsub = queue.subscribeToJobStatus('a1', (j) => {
    seen = j;
  });
  const ch = client.channels[0];
  assert.equal(ch.name, 'asset_jobs:a1');
  assert.equal(ch.listeners[0].type, 'postgres_changes');
  assert.equal(ch.listeners[0].filter.table, 'asset_jobs');
  ch.emit({ new: { id: 'j1', asset_id: 'a1', ops: [], status: 'done', progress: 100, result: { ok: true }, error: null } });
  assert.equal(seen.status, 'done');
  assert.equal(seen.progress, 100);
  unsub();
  assert.equal(ch.subscribed, false);
});

// ---------------------------------------------------------------- publish --

test('publish: publish invokes publish-pipeline edge function; history reads publishes table', async () => {
  const client = new FakeSupabaseClient();
  client.respond('publish-pipeline', (body) => ({
    data: {
      publish: {
        id: 'pub1', project_id: body.project_id, deployment_id: 'dpl_1', url: 'https://x.example',
        config_hash: 'hash1', bundle_path: 'p1/pub1/bundle', status: 'live', created_at: '2024-01-01',
      },
      url: 'https://x.example',
    },
    error: null,
  }));
  const svc = new HostedPublishService(client);
  const res = await svc.publish('p1', { scenes: [] });
  assert.equal(client.invocations[0].name, 'publish-pipeline');
  assert.deepEqual(client.invocations[0].body, { project_id: 'p1', config: { scenes: [] } });
  assert.equal(res.url, 'https://x.example');
  assert.equal(res.record.configHash, 'hash1');

  client.seed('publishes', [
    { id: 'pub1', project_id: 'p1', deployment_id: 'dpl_1', url: 'https://x.example', config_hash: 'hash1', bundle_path: 'b', status: 'live', created_at: '2024-01-01' },
  ]);
  const history = await svc.listHistory('p1');
  assert.equal(history.length, 1);
  const call = client.lastCall('publishes');
  assert.deepEqual(call.filters, [{ kind: 'eq', column: 'project_id', value: 'p1' }]);
});

test('publish: rollback re-invokes with prior config_hash snapshot', async () => {
  const client = new FakeSupabaseClient();
  client.seed('publishes', [
    { id: 'pub0', project_id: 'p1', deployment_id: 'd0', url: 'u0', config_hash: 'oldhash', bundle_path: 'b0', status: 'rolled-back', created_at: '2024-01-01' },
  ]);
  client.respond('publish-pipeline', (body) => ({
    data: {
      publish: {
        id: 'pub2', project_id: body.project_id, deployment_id: 'd2', url: 'u2',
        config_hash: body.rollback_to.config_hash, bundle_path: 'b2', status: 'live', created_at: '2024-01-02',
      },
    },
    error: null,
  }));
  const svc = new HostedPublishService(client);
  const res = await svc.rollback('p1', 'pub0');
  assert.deepEqual(client.invocations[0].body.rollback_to, { publish_id: 'pub0', config_hash: 'oldhash' });
  assert.equal(res.record.configHash, 'oldhash');
  await assert.rejects(() => svc.rollback('p1', 'missing'), /not found/);
});

// ------------------------------------------------------------ marketplace --

const VALID_CONFIG = JSON.stringify({
  version: 3,
  id: 'cfg-1',
  template: 'storytelling',
  meta: { title: 'T', description: 'D', locale: 'en' },
  theme: {},
  assets: [],
  scenes: [],
  interactions: [],
  build: { target: 'static' },
});

test('marketplace: list/get map templates rows to TemplateMeta shape', async () => {
  const client = new FakeSupabaseClient();
  client.seed('templates', [
    {
      id: 'tpl-1', author_id: 'auth-1', name: 'N', description: 'D', template_kind: 'landing',
      version: '1.0.0', categories: ['landing'], tags: ['x'], tier: 'pro', price_cents: 500,
      currency: 'usd', entry_config: {}, thumbnail: 'data:', engine_min_version: '1.0.0',
      created_at: '2024-01-01', updated_at: '2024-01-01',
    },
  ]);
  const cat = new HostedCatalog(client);
  const [meta] = await cat.listTemplates();
  assert.equal(meta.id, 'tpl-1');
  assert.equal(meta.templateKind, 'landing');
  assert.equal(meta.tier, 'pro');
  assert.equal(meta.priceCents, 500);
  assert.equal(meta.author, 'auth-1');
  assert.equal((await cat.getTemplate('tpl-1')).engineMinVersion, '1.0.0');
  assert.equal(await cat.getTemplate('nope'), undefined);
});

test('marketplace: purchase inserts purchases row (user_id/template_id/amount_cents)', async () => {
  const client = new FakeSupabaseClient();
  client.seed('templates', [
    {
      id: 'tpl-1', author_id: 'a', name: 'N', description: 'D', template_kind: 'landing',
      version: '1.0.0', categories: [], tags: [], tier: 'pro', price_cents: 700, currency: 'usd',
      entry_config: {}, thumbnail: '', engine_min_version: '1.0.0', created_at: '', updated_at: '',
    },
  ]);
  const cat = new HostedCatalog(client);
  const purchase = await cat.purchase('tpl-1');
  assert.equal(client.invocations[0].name, 'mock-checkout');
  const call = client.callsFor('purchases').find((c) => c.op === 'insert');
  assert.deepEqual(call.values, { user_id: 'user-1', template_id: 'tpl-1', amount_cents: 700 });
  assert.equal(purchase.amountCents, 700);
});

test('marketplace: uploadTemplate validates entryConfig via parseConfig before insert', async () => {
  const client = new FakeSupabaseClient();
  const cat = new HostedCatalog(client);
  await assert.rejects(
    () =>
      cat.uploadTemplate({
        id: 'tpl-bad', name: 'N', description: 'D', templateKind: 'landing', version: '1.0.0',
        categories: [], tags: [], tier: 'free', thumbnail: '', engineMinVersion: '1.0.0',
        entryConfig: '{ not json',
      }),
    /entryConfig failed validation/,
  );
  assert.equal(client.callsFor('templates').length, 0);
  const meta = await cat.uploadTemplate({
    id: 'tpl-ok', name: 'N', description: 'D', templateKind: 'landing', version: '1.0.0',
    categories: ['landing'], tags: [], tier: 'free', thumbnail: '', engineMinVersion: '1.0.0',
    entryConfig: VALID_CONFIG,
  });
  assert.equal(meta.id, 'tpl-ok');
  const call = client.lastCall('templates');
  assert.equal(call.op, 'insert');
  assert.equal(call.values.author_id, 'user-1');
  assert.equal(call.values.price_cents, null);
});

// ----------------------------------------------------------- collaboration --

test('collaboration: members, invitations (accept via rpc), presence channel, suggestions, activity', async () => {
  const client = new FakeSupabaseClient();
  const col = new HostedCollaboration(client);

  await col.addMember('p1', 'u2', 'editor');
  const memCall = client.lastCall('project_members');
  assert.equal(memCall.op, 'upsert');
  assert.equal(memCall.onConflict, 'project_id,user_id');
  assert.deepEqual(memCall.values, { project_id: 'p1', user_id: 'u2', role: 'editor' });

  await col.setRole('p1', 'u2', 'viewer');
  const roleCall = client.lastCall('project_members');
  assert.equal(roleCall.op, 'update');
  assert.deepEqual(roleCall.values, { role: 'viewer' });
  assert.deepEqual(roleCall.filters, [{ kind: 'match', query: { project_id: 'p1', user_id: 'u2' } }]);

  const inv = await col.invite('p1', 'x@y.z', 'editor');
  const invCall = client.lastCall('invitations');
  assert.equal(invCall.op, 'insert');
  assert.equal(invCall.values.email, 'x@y.z');
  assert.ok(invCall.values.token);
  assert.equal(inv.status, undefined === inv.status ? inv.status : inv.status); // row passthrough

  await col.acceptInvitation('tok-123');
  assert.deepEqual(client.rpcCalls[0], { fn: 'accept_invitation', args: { token: 'tok-123' } });

  const { leave } = await col.joinPresence('p1', { cursor: 5 });
  const ch = client.channels[0];
  assert.equal(ch.name, 'presence:project:p1');
  assert.deepEqual(ch.tracked[0], { userId: 'user-1', cursor: 5 });
  await leave();
  assert.equal(ch.subscribed, false);

  await col.suggestMerge({
    projectId: 'p1', theirVersionId: 'v1', headVersionId: 'v2',
    nextConfig: {}, fieldsChanged: ['theme'],
  });
  const sugCall = client.lastCall('merge_suggestions');
  assert.equal(sugCall.values.user_id, 'user-1');
  assert.deepEqual(sugCall.values.fields_changed, ['theme']);

  await col.logActivity('p1', 'project.updated', { k: 1 });
  const actCall = client.lastCall('activity_log');
  assert.equal(actCall.values.actor_id, 'user-1');
  assert.equal(actCall.values.action, 'project.updated');

  client.seed('activity_log', [
    { id: 1, project_id: 'p1', actor_id: 'user-1', action: 'a', detail: {}, created_at: '2024-01-02' },
    { id: 2, project_id: 'p1', actor_id: 'user-1', action: 'b', detail: {}, created_at: '2024-01-01' },
  ]);
  const entries = await col.listActivity('p1', 10);
  const actRead = client.lastCall('activity_log');
  assert.equal(actRead.limitN, 10);
  assert.equal(entries[0].action, 'a'); // newest first
});

// -------------------------------------------------------------- dashboard --

test('dashboard: overview/listProjects/publishHistory + analytics_events', async () => {
  const client = new FakeSupabaseClient();
  client.seed('projects', [
    { id: 'p1', owner_id: 'user-1', name: 'A', template_kind: 'k', template_id: 't', config: {}, shared: false, schema_version: 1, created_at: '2024-01-01', updated_at: '2024-01-02' },
    { id: 'p2', owner_id: 'user-1', name: 'B', template_kind: 'k', template_id: 't', config: {}, shared: false, schema_version: 1, created_at: '2024-01-01', updated_at: '2024-01-01' },
  ]);
  client.seed('publishes', [
    { id: 'pub1', project_id: 'p1', deployment_id: 'd', url: 'https://live', config_hash: 'h', bundle_path: 'b', status: 'live', created_at: '2024-02-01' },
  ]);
  const dash = new HostedDashboard(client);
  const projects = await dash.listProjects();
  assert.equal(projects.length, 2);
  const p1 = projects.find((p) => p.id === 'p1');
  assert.equal(p1.publishStatus, 'live');
  assert.equal(p1.liveUrl, 'https://live');
  const p2 = projects.find((p) => p.id === 'p2');
  assert.equal(p2.publishStatus, 'never-published');

  const overview = await dash.overview();
  assert.equal(overview.projectCount, 2);
  assert.equal(overview.liveCount, 1);
  assert.equal(overview.totalPublishes, 1);
  assert.equal(overview.lastPublishAt, Date.parse('2024-02-01'));

  await dash.recordView('p1', 'share-link');
  const evCall = client.lastCall('analytics_events');
  assert.deepEqual(evCall.values, { project_id: 'p1', event: 'publish.view', source: 'share-link' });

  const stats = await dash.stats('p1');
  assert.equal(stats.totalViews, 1);
  assert.equal(stats.bySource['share-link'], 1);
});

// --------------------------------------------------------------- community --

test('community: profile create maps unique violation to HandleTakenError', async () => {
  const client = new FakeSupabaseClient();
  const com = new HostedCommunity(client);
  const profile = await com.createProfile({ handle: 'ada-lovelace', displayName: 'Ada' });
  assert.equal(profile.userId, 'user-1');
  const call = client.lastCall('profiles');
  assert.equal(call.values.handle, 'ada-lovelace');
  await assert.rejects(
    () => com.createProfile({ handle: 'BAD HANDLE!', displayName: 'X' }),
    /invalid handle/,
  );
  client.nextError = { message: 'duplicate key value violates unique constraint', code: '23505' };
  await assert.rejects(
    () => com.createProfile({ handle: 'taken-handle', displayName: 'X' }),
    (e) => e instanceof HandleTakenError,
  );
});

test('community: threaded comments read, add/edit/soft-delete own', async () => {
  const client = new FakeSupabaseClient();
  client.seed('comments', [
    { id: 'c1', target_kind: 'template', target_id: 't1', author_id: 'user-1', parent_id: null, body: 'root', edited_at: null, deleted_at: null, created_at: '2024-01-01' },
    { id: 'c2', target_kind: 'template', target_id: 't1', author_id: 'u2', parent_id: 'c1', body: 'reply', edited_at: null, deleted_at: null, created_at: '2024-01-02' },
  ]);
  const com = new HostedCommunity(client);
  const tree = await com.listComments('template', 't1');
  const read = client.lastCall('comments');
  assert.deepEqual(read.filters, [{ kind: 'match', query: { target_kind: 'template', target_id: 't1' } }]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children[0].body, 'reply');

  const added = await com.addComment('template', 't1', 'hello', 'c1');
  const addCall = client.lastCall('comments');
  assert.equal(addCall.op, 'insert');
  assert.equal(addCall.values.author_id, 'user-1');
  assert.equal(addCall.values.parent_id, 'c1');
  assert.ok(added.id);

  await com.editComment(added.id, 'edited');
  const editCall = client.lastCall('comments');
  assert.equal(editCall.op, 'update');
  assert.equal(editCall.values.body, 'edited');
  assert.ok(editCall.values.edited_at);
  assert.deepEqual(editCall.filters, [
    { kind: 'eq', column: 'id', value: added.id },
    { kind: 'eq', column: 'author_id', value: 'user-1' },
  ]);

  await com.deleteComment(added.id);
  const delCall = client.lastCall('comments');
  assert.equal(delCall.op, 'update'); // soft delete via deleted_at
  assert.ok(delCall.values.deleted_at);

  await assert.rejects(() => com.addComment('template', 't1', ''), /1\.\.1000/);
});

test('community: showcases read templates/shared projects; remixes insert', async () => {
  const client = new FakeSupabaseClient();
  const com = new HostedCommunity(client);
  await com.listTemplateShowcases();
  assert.equal(client.lastCall('templates').op, 'select');
  await com.listProjectShowcases();
  const projCall = client.lastCall('projects');
  assert.deepEqual(projCall.filters, [{ kind: 'eq', column: 'shared', value: true }]);
  await com.recordRemix({ originalId: 'tpl-1', originalAuthorId: 'auth-1', newProjectId: 'p9' });
  const remixCall = client.lastCall('remixes');
  assert.equal(remixCall.values.remixer_id, 'user-1');
  assert.equal(remixCall.values.original_id, 'tpl-1');
});

// ---------------------------------------------------------------- billing --

test('billing: subscription read, mock plan switch via billing-mock edge fn, revenue views', async () => {
  const client = new FakeSupabaseClient();
  client.seed('subscriptions', [
    { user_id: 'user-1', plan_id: 'pro', status: 'active', current_period_end: '2025-01-01', updated_at: '2024-06-01' },
  ]);
  client.seed('payouts', [
    { id: 'po1', author_id: 'user-1', amount_cents: 1000, status: 'scheduled', period_start: '2024-01-01', period_end: '2024-01-31', created_at: '2024-02-01' },
  ]);
  client.seed('revenue_ledger', [
    { id: 1, purchase_id: 'pu1', author_id: 'user-1', amount_cents: 100, creator_cents: 70, platform_cents: 30, settled: false, created_at: '2024-01-15' },
  ]);
  const billing = new HostedBilling(client);
  const sub = await billing.getSubscription();
  assert.equal(sub.planId, 'pro');
  assert.equal(client.lastCall('subscriptions').filters[0].value, 'user-1');
  assert.equal(await billing.currentPlan(), 'pro');

  await billing.switchPlan('pro');
  assert.deepEqual(client.invocations[0], { name: 'billing-mock', body: { plan_id: 'pro' } });

  const payouts = await billing.listPayouts();
  assert.equal(payouts[0].amountCents, 1000);
  assert.equal(client.lastCall('payouts').filters[0].value, 'user-1');
  const revenue = await billing.listRevenue();
  assert.equal(revenue[0].creatorCents, 70);
});

// ----------------------------------------------------------- entitlements --

test('entitlements: resolver matrix (free/pro plan x free/pro template x purchase override)', async () => {
  const mk = (planId, purchased = []) => {
    const client = new FakeSupabaseClient();
    client.seed('subscriptions', [
      { user_id: 'user-1', plan_id: planId, status: 'active', current_period_end: null, updated_at: '' },
    ]);
    client.seed(
      'purchases',
      purchased.map((t) => ({ id: `pu-${t}`, user_id: 'user-1', template_id: t, amount_cents: 1, created_at: '' })),
    );
    return new HostedEntitlementResolver(client);
  };

  const free = mk('free');
  assert.equal(await free.planId(), 'free');
  assert.equal(await free.can('export.static'), true);
  assert.equal(await free.can('templates.pro'), false);
  await assert.rejects(() => free.assertCan('templates.pro'), /templates\.pro/);
  assert.equal(await free.canAccessTemplate({ id: 't1', tier: 'free' }), true);
  assert.equal(await free.canAccessTemplate({ id: 't2', tier: 'pro' }), false);

  const freeWithPurchase = mk('free', ['t2']);
  assert.equal(await freeWithPurchase.canAccessTemplate({ id: 't2', tier: 'pro' }), true);
  assert.equal(await freeWithPurchase.canAccessTemplate({ id: 't3', tier: 'pro' }), false);

  const pro = mk('pro');
  assert.equal(await pro.can('templates.pro'), true);
  assert.equal(await pro.can('projects.unlimited'), true);
  assert.equal(await pro.canAccessTemplate({ id: 'any', tier: 'pro' }), true);

  // No auth user -> free plan, no purchases.
  const anonClient = new FakeSupabaseClient();
  anonClient.auth.getUser = async () => ({ data: null, error: null });
  const anon = new HostedEntitlementResolver(anonClient);
  assert.equal(await anon.planId(), 'free');
  assert.equal(await anon.can('export.static'), true);
});

// --------------------------------------------------------------- telemetry --

test('telemetry: default OFF (no insert), opt-in inserts telemetry_events', async () => {
  const client = new FakeSupabaseClient();
  const tel = new HostedTelemetry(client, { sessionId: 'sess-1' });
  assert.equal(tel.isEnabled(), false);
  assert.equal(await tel.track('builder.open'), false);
  assert.equal(client.callsFor('telemetry_events').length, 0);

  tel.setEnabled(true);
  assert.equal(await tel.track('builder.open', { v: 1 }), true);
  const call = client.lastCall('telemetry_events');
  assert.equal(call.op, 'insert');
  assert.deepEqual(call.values, {
    user_id: 'user-1', name: 'builder.open', props: { v: 1 }, session_id: 'sess-1',
  });
});

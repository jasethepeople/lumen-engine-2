/**
 * @lumen/app-publish — headless Node tests.
 *
 * Covers: export bundle shape, budget enforcement (BudgetExceededError),
 * mock Vercel deployment lifecycle (+ no-network assertion), publish history
 * recording, rollback restoring the exact prior configHash and flipping
 * statuses, snapshot cap pruning, and entitlement gate invocation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  StaticExporter,
  MemorySink,
  NodeFsSink,
  BudgetExceededError,
  MockVercelClient,
  MemoryVercelStore,
  LocalStorageVercelStore,
  PublishService,
  MemoryPublishHistoryStore,
  LocalStoragePublishHistoryStore,
  SNAPSHOT_CAP,
} from '../dist/index.js';

import { parseConfig } from '@lumen/config';

const here = dirname(fileURLToPath(import.meta.url));
const parsedConfig = parseConfig(
  readFileSync(join(here, '../../../examples/simple-site/engine.config.json'), 'utf8'),
);
assert.equal(parsedConfig.ok, true);
const config = parsedConfig.config;

function makeService(opts = {}) {
  const vercel = new MockVercelClient({ latencyMs: 0 });
  const history = new MemoryPublishHistoryStore();
  const service = new PublishService({ vercel, history, ...opts });
  return { service, vercel, history };
}

test('StaticExporter: bundle shape — files, manifest, budgets, entry, configHash', async () => {
  const exporter = new StaticExporter();
  const sink = new MemorySink();
  const bundle = await exporter.export(config, { sink });

  assert.ok(bundle.files instanceof Map);
  assert.ok(bundle.files.size > 0);
  assert.ok(bundle.files.has('manifest.json'));
  assert.ok(bundle.files.has(bundle.entry), `entry ${bundle.entry} present`);
  assert.equal(bundle.manifest.target, 'static');
  assert.equal(bundle.manifest.entry, bundle.entry);
  assert.ok(Array.isArray(bundle.manifest.files));
  assert.ok(bundle.manifest.files.length >= 1);
  for (const f of bundle.manifest.files) assert.ok(bundle.files.has(f.path), `manifest file ${f.path}`);
  assert.equal(bundle.budgets.passed, true);
  assert.match(bundle.configHash, /^[0-9a-f]+$/);
  // sink received every file
  assert.deepEqual([...sink.files.keys()].sort(), [...bundle.files.keys()].sort());
  // manifest.json content round-trips to the manifest
  assert.deepEqual(JSON.parse(bundle.files.get('manifest.json')).entry, bundle.entry);
});

test('StaticExporter: deterministic configHash; project-like {id,name,config} input', async () => {
  const exporter = new StaticExporter();
  const a = await exporter.export(config);
  const b = await exporter.export({ id: 'proj-1', name: 'My Site', config });
  assert.equal(a.configHash, b.configHash);
});

test('StaticExporter: NodeFsSink materializes a directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-export-'));
  const exporter = new StaticExporter();
  const bundle = await exporter.export(config, { sink: new NodeFsSink(dir) });
  assert.ok(existsSync(join(dir, bundle.entry)));
  assert.ok(existsSync(join(dir, 'manifest.json')));
});

test('budgets enforced: violating budget → BudgetExceededError with violations', async () => {
  const exporter = new StaticExporter();
  await assert.rejects(
    exporter.export(config, { strictBudgets: true, budgets: [{ metric: 'js-gz', budget: 1 }] }),
    (err) => {
      assert.ok(err instanceof BudgetExceededError);
      assert.equal(err.name, 'BudgetExceededError');
      assert.ok(err.violations.length > 0);
      assert.equal(err.violations[0].metric, 'js-gz');
      assert.ok(err.violations[0].actual > 1);
      return true;
    },
  );
});

test('MockVercelClient: create/get/list lifecycle with mock URL, no HTTP', async () => {
  // Any real network attempt fails loudly.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network forbidden'); };
  try {
    const store = new MemoryVercelStore();
    const client = new MockVercelClient({ store });
    const dep = await client.createDeployment({
      name: 'My Cool Site!',
      files: [{ path: 'index.html', content: '<html/>' }],
    });
    assert.equal(dep.state, 'READY');
    assert.match(dep.url, /^https:\/\/my-cool-site-[a-z0-9]+\.mock\.vercel\.app$/);
    assert.ok(dep.deploymentId);
    assert.equal(typeof dep.createdAt, 'number');

    const fetched = await client.getDeployment(dep.deploymentId);
    assert.equal(fetched.url, dep.url);
    assert.equal(await client.getDeployment('nope'), undefined);

    const list = await client.listDeployments('My Cool Site!');
    assert.equal(list.length, 1);
    assert.equal((await client.listDeployments('other')).length, 0);

    // store persistence: a second client over the same store sees the deployment
    const client2 = new MockVercelClient({ store });
    assert.equal((await client2.listDeployments('My Cool Site!')).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('MockVercelClient: injected latency is honored', async () => {
  const client = new MockVercelClient({ latencyMs: 20 });
  const start = Date.now();
  await client.createDeployment({ name: 'x', files: [] });
  assert.ok(Date.now() - start >= 18);
});

test('LocalStorageVercelStore: persists via global localStorage shim', async () => {
  const backing = new Map();
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  };
  try {
    const client = new MockVercelClient({ store: new LocalStorageVercelStore() });
    const dep = await client.createDeployment({ name: 'ls-site', files: [] });
    assert.ok(backing.size > 0);
    const again = new MockVercelClient({ store: new LocalStorageVercelStore() });
    assert.equal((await again.listDeployments('ls-site'))[0].deploymentId, dep.deploymentId);
  } finally {
    delete globalThis.localStorage;
  }
});

test('PublishService.publish: deploys, records live history, snapshot saved', async () => {
  const { service, vercel } = makeService();
  const { record, bundle } = await service.publish(config, { target: 'vercel-mock' });

  assert.equal(record.status, 'live');
  assert.equal(record.projectId, config.id);
  assert.equal(record.configHash, bundle.configHash);
  assert.match(record.url, /\.mock\.vercel\.app$/);

  const history = service.listHistory(config.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].id, record.id);

  const deployments = await vercel.listDeployments(config.meta.title);
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0].files.length, bundle.files.size);
});

test('PublishService.publish: budget violation blocks deploy + history', async () => {
  const { service, vercel } = makeService();
  await assert.rejects(
    service.publish(config, { budgets: [{ metric: 'js-gz', budget: 1 }] }),
    BudgetExceededError,
  );
  assert.equal(service.listHistory(config.id).length, 0);
  assert.equal((await vercel.listDeployments(config.meta.title)).length, 0);
});

test('rollback: redeploys exact prior snapshot, restores configHash, flips statuses', async () => {
  const { service, vercel } = makeService();
  const first = await service.publish(config);
  const changed = { ...config, meta: { ...config.meta, title: 'Renamed Site' } };
  const second = await service.publish(changed);
  assert.notEqual(first.record.configHash, second.record.configHash);

  const rolled = await service.rollback(config.id, first.record.id);
  assert.equal(rolled.status, 'live');
  assert.equal(rolled.configHash, first.record.configHash);
  assert.notEqual(rolled.deploymentId, first.record.deploymentId);

  const history = service.listHistory(config.id);
  assert.equal(history.length, 3);
  assert.equal(history.find((r) => r.id === first.record.id).status, 'rolled-back');
  assert.equal(history.find((r) => r.id === second.record.id).status, 'live');
  assert.equal(history.find((r) => r.id === rolled.id).status, 'live');

  // The rollback deployment contains exactly the first bundle's files.
  const rolledDep = await vercel.getDeployment(rolled.deploymentId);
  const firstPaths = [...first.bundle.files.keys()].sort();
  assert.deepEqual(rolledDep.files.map((f) => f.path).sort(), firstPaths);
  for (const f of rolledDep.files) {
    assert.equal(f.content, first.bundle.files.get(f.path));
  }
});

test('rollback: missing snapshot → typed error', async () => {
  const { service, history } = makeService();
  const { record } = await service.publish(config);
  // wipe snapshot by publishing SNAPSHOT_CAP more (prunes the first)
  for (let i = 0; i < SNAPSHOT_CAP; i++) {
    await service.publish({ ...config, meta: { ...config.meta, description: `v${i}` } });
  }
  await assert.rejects(service.rollback(config.id, record.id), /pruned or missing/);
  assert.ok(history.getSnapshot(record.id) === undefined);
});

test('snapshot cap: at most SNAPSHOT_CAP snapshots retained per project', async () => {
  const history = new MemoryPublishHistoryStore();
  for (let i = 0; i < SNAPSHOT_CAP + 5; i++) {
    history.saveSnapshot('p', { publishRecordId: `r${i}`, files: {} });
  }
  assert.equal(history.getSnapshot('r0'), undefined); // pruned
  assert.equal(history.getSnapshot(`r${SNAPSHOT_CAP + 4}`)?.publishRecordId, `r${SNAPSHOT_CAP + 4}`);
  assert.equal(history.getSnapshot('r5')?.publishRecordId, 'r5'); // oldest retained
});

test('gate: assertCan invoked before publish and rollback; default allows', async () => {
  const calls = [];
  const gate = { assertCan(key) { calls.push(key); } };
  const { service } = makeService({ gate });
  const { record } = await service.publish(config);
  await service.rollback(config.id, record.id);
  assert.deepEqual(calls, ['publish.vercel', 'publish.vercel']);

  const denying = {
    assertCan() { throw new Error('plan limit reached'); },
  };
  const { service: blocked } = makeService({ gate: denying });
  await assert.rejects(blocked.publish(config), /plan limit reached/);
  assert.equal(blocked.listHistory(config.id).length, 0);
});

test('LocalStoragePublishHistoryStore: records persist across instances', async () => {
  const backing = new Map();
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  };
  try {
    const history = new LocalStoragePublishHistoryStore();
    const service = new PublishService({ vercel: new MockVercelClient(), history });
    const { record } = await service.publish(config);
    const history2 = new LocalStoragePublishHistoryStore();
    assert.equal(history2.listRecords(config.id)[0].id, record.id);
    assert.ok(history2.getSnapshot(record.id));
  } finally {
    delete globalThis.localStorage;
  }
});

test('no fetch / node:http usage in compiled sources', () => {
  const fsPaths = ['../dist/exporter.js', '../dist/vercel.js', '../dist/service.js'];
  for (const rel of fsPaths) {
    const src = readFileSync(join(here, rel), 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(src), `${rel} must not call fetch`);
    assert.ok(!src.includes("node:http") && !src.includes("node:https"), `${rel} must not import http`);
  }
});

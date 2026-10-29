/**
 * tests/saas-smoke — (d) publish → mock Vercel → history; rollback.
 *
 * The facade's publish slot is an offline stub, so this exercises the real
 * @lumen/app-publish pipeline directly: StaticExporter → MockVercelClient
 * (the package's shipped offline Vercel — zero network, verified by
 * poisoning global fetch) → MemoryPublishHistoryStore, then rollback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '@lumen/config';
import {
  MemoryPublishHistoryStore,
  MockVercelClient,
  PublishService,
} from '@lumen/app-publish';

const here = dirname(fileURLToPath(import.meta.url));
const parsed = parseConfig(
  readFileSync(join(here, '../../examples/simple-site/engine.config.json'), 'utf8'),
);
assert.equal(parsed.ok, true);
const config = parsed.config;

test('(d) publish → mock Vercel → history; rollback restores prior hash', async () => {
  // Any real network attempt fails loudly.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('network forbidden in saas-smoke');
  };
  try {
    const vercel = new MockVercelClient({ latencyMs: 0 });
    const history = new MemoryPublishHistoryStore();
    const service = new PublishService({ vercel, history });

    const first = await service.publish(config, { target: 'vercel-mock' });
    assert.equal(first.record.status, 'live');
    assert.equal(first.record.projectId, config.id);
    assert.equal(first.record.configHash, first.bundle.configHash);
    assert.match(first.record.url, /\.mock\.vercel\.app$/);
    assert.ok(first.bundle.files.has('manifest.json'));

    const changed = { ...config, meta: { ...config.meta, title: 'Renamed Site' } };
    const second = await service.publish(changed);
    assert.notEqual(first.record.configHash, second.record.configHash);

    // History: two live records, newest first in list order preserved.
    const records = service.listHistory(config.id);
    assert.equal(records.length, 2);

    const deployments = await vercel.listDeployments(config.meta.title);
    assert.ok(deployments.length >= 1);

    // Rollback to the first publish: exact prior snapshot redeployed.
    const rolled = await service.rollback(config.id, first.record.id);
    assert.equal(rolled.status, 'live');
    assert.equal(rolled.configHash, first.record.configHash);
    assert.notEqual(rolled.deploymentId, first.record.deploymentId);

    const after = service.listHistory(config.id);
    assert.equal(after.length, 3);
    assert.equal(after.find((r) => r.id === first.record.id).status, 'rolled-back');
    assert.equal(after.find((r) => r.id === rolled.id).status, 'live');

    const rolledDep = await vercel.getDeployment(rolled.deploymentId);
    assert.deepEqual(
      rolledDep.files.map((f) => f.path).sort(),
      [...first.bundle.files.keys()].sort(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/**
 * tests/saas-smoke — (h) dashboard overview + analytics.
 *
 * The facade's dashboard slot is an offline stub, so this exercises the real
 * @lumen/app-dashboard services composed over the offline backend's REAL
 * ProjectStore and the real @lumen/app-publish mock pipeline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '@lumen/config';
import { createOfflineBackend } from '@lumen/backend-supabase';
import {
  AnalyticsStore,
  DashboardService,
  dayStart,
} from '@lumen/app-dashboard';
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

const DAY = 24 * 60 * 60 * 1000;

test('(h) dashboard overview + analytics over the real offline stack', async () => {
  let clock = 1_700_000_000_000;
  const backend = createOfflineBackend();
  const projects = backend.projects;
  const publish = new PublishService({
    vercel: new MockVercelClient({ latencyMs: 0 }),
    history: new MemoryPublishHistoryStore(),
    clock: () => clock,
  });
  const dashboard = new DashboardService({ projects, publish });

  // Empty overview first.
  assert.deepEqual(await dashboard.overview(), {
    projectCount: 0,
    liveCount: 0,
    totalPublishes: 0,
    lastPublishAt: 0,
  });

  const a = await projects.createProject({
    name: 'Alpha', templateKind: 'site', templateId: 'simple', config,
  });
  const b = await projects.createProject({
    name: 'Beta', templateKind: 'site', templateId: 'simple', config,
  });
  await projects.updateProject(a.id, { name: 'Alpha v2' }, 'rename');

  clock = 1_700_000_100_000;
  await publish.publish({ id: b.id, name: b.name, config });
  clock = 1_700_000_200_000;
  await publish.publish({ id: b.id, name: b.name, config });

  const overview = await dashboard.overview();
  assert.deepEqual(overview, {
    projectCount: 2,
    liveCount: 1,
    totalPublishes: 2,
    lastPublishAt: 1_700_000_200_000,
  });

  const list = await dashboard.listProjects();
  const da = list.find((p) => p.id === a.id);
  const db = list.find((p) => p.id === b.id);
  assert.equal(da.publishStatus, 'never-published');
  assert.equal(da.versionCount, 2);
  assert.equal(db.publishStatus, 'live');
  assert.equal(db.publishCount, 2);
  assert.ok(db.liveUrl.endsWith('.mock.vercel.app'));

  // Dashboard rollback delegates to the real publish service.
  const firstRecord = dashboard.publishHistory(b.id)[0];
  const rolled = await dashboard.rollback(b.id, firstRecord.id);
  assert.equal(rolled.configHash, firstRecord.configHash);
  assert.equal(
    dashboard.publishHistory(b.id).find((r) => r.id === firstRecord.id).status,
    'rolled-back',
  );

  // Analytics: views-by-day + top projects through the real store.
  const noon = dayStart(clock) + 12 * 60 * 60 * 1000;
  const analytics = new AnalyticsStore({ now: () => noon });
  analytics.recordView(a.id, { ts: noon });
  analytics.recordView(a.id, { ts: noon - DAY });
  analytics.recordView(a.id, { ts: noon - DAY, source: 'share-link' });
  for (let i = 0; i < 5; i++) analytics.recordView(b.id, { ts: noon });

  const stats = analytics.stats(a.id, { days: 7 });
  assert.equal(stats.views, 3);
  assert.equal(stats.uniqueDays, 2);
  assert.equal(stats.viewsByDay.length, 7);
  assert.deepEqual(analytics.topProjects(1), [{ projectId: b.id, views: 5 }]);
});

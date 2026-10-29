/**
 * @lumen/app-dashboard — headless Node tests.
 *
 * Covers: dashboard aggregation correctness, rollback delegation,
 * analytics recording/cap/daily stats/top projects, preview lifecycle +
 * expiry, share link token/expiry/invalid-token rejection, and the
 * guarantee that previews never pollute publish history. Zero network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DashboardService,
  AnalyticsStore,
  MemoryAnalyticsStorage,
  ANALYTICS_CAP,
  dayStart,
  PreviewService,
  DEFAULT_PREVIEW_TTL_MS,
} from '../dist/index.js';

import { PublishService, MockVercelClient, MemoryPublishHistoryStore } from '@lumen/app-publish';
import { ProjectStore } from '@lumen/app-projects';
import { parseConfig } from '@lumen/config';

const here = dirname(fileURLToPath(import.meta.url));
const parsed = parseConfig(
  readFileSync(join(here, '../../../examples/simple-site/engine.config.json'), 'utf8'),
);
assert.equal(parsed.ok, true);
const config = parsed.config;

const DAY = 24 * 60 * 60 * 1000;

async function makeWorld(now = 1_700_000_000_000) {
  let clock = now;
  const projects = new ProjectStore(undefined, { now: () => clock });
  const vercel = new MockVercelClient({ latencyMs: 0 });
  const history = new MemoryPublishHistoryStore();
  const publish = new PublishService({ vercel, history, clock: () => clock });
  const dashboard = new DashboardService({ projects, publish });
  const preview = new PreviewService({
    projects,
    clock: () => clock,
    nextId: (() => { let n = 0; return () => `id_${(++n).toString(36)}`; })(),
  });
  const setClock = (t) => { clock = t; };
  return { projects, publish, vercel, history, dashboard, preview, setClock, getClock: () => clock };
}

async function seedProject(projects, name) {
  return projects.createProject({ name, templateKind: 'site', templateId: 'simple', config });
}

test('DashboardService: aggregation — latest publish status + version count', async () => {
  const { projects, publish, dashboard } = await makeWorld();
  const a = await seedProject(projects, 'Alpha');
  const b = await seedProject(projects, 'Beta');
  await projects.updateProject(a.id, { name: 'Alpha v2' }, 'rename'); // 2 versions now

  await publish.publish({ id: b.id, name: b.name, config });
  await publish.publish({ id: b.id, name: b.name, config });

  const list = await dashboard.listProjects();
  assert.equal(list.length, 2);
  const da = list.find((p) => p.id === a.id);
  const db = list.find((p) => p.id === b.id);
  assert.equal(da.publishStatus, 'never-published');
  assert.equal(da.publishCount, 0);
  assert.equal(da.latestPublish, undefined);
  assert.equal(da.versionCount, 2);
  assert.equal(db.publishStatus, 'live');
  assert.equal(db.publishCount, 2);
  assert.ok(db.latestPublish.url);
  assert.equal(db.liveUrl, db.latestPublish.url);
  assert.equal(db.versionCount, 1);
});

test('DashboardService: publishHistory delegates to PublishService', async () => {
  const { projects, publish, dashboard } = await makeWorld();
  const a = await seedProject(projects, 'Alpha');
  await publish.publish({ id: a.id, name: a.name, config });
  assert.deepEqual(dashboard.publishHistory(a.id), publish.listHistory(a.id));
  assert.equal(dashboard.publishHistory('no-such-project').length, 0);
});

test('DashboardService: rollback delegates and flips statuses', async () => {
  const { projects, publish, dashboard } = await makeWorld();
  const a = await seedProject(projects, 'Alpha');
  const r1 = (await publish.publish({ id: a.id, name: a.name, config })).record;
  const r2 = (await publish.publish({ id: a.id, name: a.name, config })).record;

  const rolled = await dashboard.rollback(a.id, r1.id);
  assert.equal(rolled.status, 'live');
  const history = dashboard.publishHistory(a.id);
  // PublishService semantics: the record rolled back TO flips to
  // 'rolled-back' and a fresh 'live' record is appended with its hash.
  assert.equal(history.find((r) => r.id === r1.id).status, 'rolled-back');
  assert.equal(history.find((r) => r.id === r2.id).status, 'live');
  assert.equal(rolled.configHash, r1.configHash);
  assert.equal(history.length, 3);

  const list = await dashboard.listProjects();
  assert.equal(list[0].publishStatus, 'live');

  await assert.rejects(() => dashboard.rollback(a.id, 'missing'), /no publish record/);
});

test('DashboardService: overview counters', async () => {
  const { projects, publish, dashboard, setClock } = await makeWorld();
  const empty = await dashboard.overview();
  assert.deepEqual(empty, { projectCount: 0, liveCount: 0, totalPublishes: 0, lastPublishAt: 0 });

  const a = await seedProject(projects, 'Alpha');
  const b = await seedProject(projects, 'Beta');
  const t1 = 1_700_000_100_000;
  setClock(t1);
  await publish.publish({ id: a.id, name: a.name, config });
  const t2 = 1_700_000_200_000;
  setClock(t2);
  await publish.publish({ id: a.id, name: a.name, config });
  await publish.publish({ id: b.id, name: b.name, config });

  const overview = await dashboard.overview();
  assert.deepEqual(overview, {
    projectCount: 2,
    liveCount: 2,
    totalPublishes: 3,
    lastPublishAt: t2,
  });
});

test('AnalyticsStore: recording, windowing, daily stats, uniqueDays', () => {
  const now = dayStart(1_700_000_000_000) + 12 * 60 * 60 * 1000; // noon UTC
  const analytics = new AnalyticsStore({ now: () => now });
  analytics.recordView('p1', { ts: now }); // today
  analytics.recordView('p1', { ts: now - DAY }); // yesterday
  analytics.recordView('p1', { ts: now - DAY, source: 'share-link' });
  analytics.recordView('p1', { ts: now - 10 * DAY }); // outside 7d window

  const stats = analytics.stats('p1', { days: 7 });
  assert.equal(stats.views, 3);
  assert.equal(stats.uniqueDays, 2);
  assert.equal(stats.viewsByDay.length, 7);
  assert.equal(stats.viewsByDay.at(-1).views, 1);
  assert.equal(stats.viewsByDay.at(-2).views, 2);
  assert.equal(stats.viewsByDay.reduce((s, d) => s + d.views, 0), 3);

  const stats3 = analytics.stats('p1', { days: 3 });
  assert.equal(stats3.views, 3);
  assert.equal(stats3.viewsByDay.length, 3);

  assert.equal(analytics.stats('p1', { days: 30 }).views, 4);
  assert.equal(analytics.stats('other', { days: 7 }).views, 0);
  assert.throws(() => analytics.recordView(''), /projectId/);
});

test('AnalyticsStore: per-project cap evicts oldest', () => {
  const analytics = new AnalyticsStore({ now: () => 1_700_000_000_000 });
  for (let i = 0; i < ANALYTICS_CAP + 50; i++) {
    analytics.recordView('p1', { ts: 1_700_000_000_000 + i });
  }
  const views = analytics.listViews('p1');
  assert.equal(views.length, ANALYTICS_CAP);
  assert.equal(views[0].ts, 1_700_000_000_000 + 50); // oldest 50 evicted
  // cap is per-project
  analytics.recordView('p2');
  assert.equal(analytics.listViews('p2').length, 1);
});

test('AnalyticsStore: topProjects ranks by total views with limit', () => {
  const storage = new MemoryAnalyticsStorage();
  const analytics = new AnalyticsStore({ storage, now: () => 0 });
  for (let i = 0; i < 5; i++) analytics.recordView('p1');
  for (let i = 0; i < 3; i++) analytics.recordView('p2');
  for (let i = 0; i < 8; i++) analytics.recordView('p3');

  assert.deepEqual(analytics.topProjects(2), [
    { projectId: 'p3', views: 8 },
    { projectId: 'p1', views: 5 },
  ]);
  assert.deepEqual(analytics.topProjects(10).map((e) => e.projectId), ['p3', 'p1', 'p2']);
  assert.deepEqual(analytics.topProjects(0), []);
});

test('PreviewService: lifecycle — create/get/expiry, budgets included', async () => {
  const { projects, preview, setClock, getClock } = await makeWorld();
  const a = await seedProject(projects, 'Alpha');

  const created = await preview.createPreview(a.id);
  assert.ok(created.previewId);
  assert.equal(created.projectId, a.id);
  assert.ok(created.bundle.files.size > 0);
  assert.equal(created.budgets.passed, true);
  assert.equal(created.expiresAt, getClock() + DEFAULT_PREVIEW_TTL_MS);

  const fetched = preview.getPreview(created.previewId);
  assert.equal(fetched.previewId, created.previewId);

  // past expiry → gone
  setClock(created.expiresAt);
  assert.equal(preview.getPreview(created.previewId), undefined);

  await assert.rejects(() => preview.createPreview('missing'), /project not found/);
});

test('PreviewService: previews never touch publish history or the network deploy path', async () => {
  const { projects, publish, history, vercel, preview } = await makeWorld();
  const a = await seedProject(projects, 'Alpha');

  await preview.createPreview(a.id);
  await preview.createPreview(a.id);

  assert.equal(history.listRecords(a.id).length, 0);
  assert.equal(publish.listHistory(a.id).length, 0);
  assert.equal((await vercel.listDeployments('Alpha')).length, 0); // nothing deployed
});

test('PreviewService: mock share link — token, expiry, invalid rejection', async () => {
  const { projects, preview, setClock } = await makeWorld();
  const a = await seedProject(projects, 'My Cool Site');
  const created = await preview.createPreview(a.id);

  const link = preview.sharePreview(created.previewId);
  assert.match(link.url, /^https:\/\/preview-my-cool-site-[a-z0-9_]+\.mock\.lumen\.app$/);
  assert.ok(link.token);
  assert.equal(link.previewId, created.previewId);
  assert.equal(link.expiresAt, created.expiresAt);

  const resolved = preview.resolveShareLink(link.token);
  assert.equal(resolved.previewId, created.previewId);
  assert.ok(resolved.bundle.files.size > 0);

  assert.throws(() => preview.resolveShareLink('bogus-token'), /invalid share token/);

  // expiry invalidates the link
  setClock(link.expiresAt);
  assert.throws(() => preview.resolveShareLink(link.token), /expired/);

  // sharing an expired/unknown preview fails
  assert.throws(() => preview.sharePreview(created.previewId), /no live preview/);
  assert.throws(() => preview.sharePreview('nope'), /no live preview/);
});

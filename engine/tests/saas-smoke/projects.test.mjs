/**
 * tests/saas-smoke — (b) project CRUD + autosave + versioning + restore.
 *
 * Exercises the offline backend facade's projects slot directly: it IS the
 * real @lumen/app-projects ProjectStore (MemoryStorage adapter) that
 * createOfflineBackend() delegates to, plus the real AutosaveManager.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineBackend } from '@lumen/backend-supabase';
import { AutosaveManager } from '@lumen/app-projects';

test('(b) project CRUD through the offline backend facade', async () => {
  const backend = createOfflineBackend();
  const store = backend.projects;

  const p = await store.createProject({
    name: 'Alpha',
    templateKind: 'scroll-video',
    templateId: 'scroll-cinema-landing',
    config: { v: 0 },
  });
  assert.equal(p.schemaVersion, 1);
  assert.ok(p.id);

  assert.equal((await store.listProjects()).length, 1);
  assert.deepEqual((await store.getProject(p.id)).config, { v: 0 });

  const updated = await store.updateProject(p.id, { name: 'Alpha v2' });
  assert.equal(updated.name, 'Alpha v2');
  assert.equal(updated.createdAt, p.createdAt);

  const copy = await store.duplicateProject(p.id);
  assert.equal(copy.name, 'Alpha v2 (copy)');
  assert.equal((await store.listProjects()).length, 2);

  assert.equal(await store.deleteProject(copy.id), true);
  assert.equal(await store.deleteProject(copy.id), false);
  assert.equal((await store.listProjects()).length, 1);
});

test('(b) autosave debounces into one versioned save; versioning + restore', async () => {
  const backend = createOfflineBackend();
  const store = backend.projects;

  // Fake clock + timers so the debounce is deterministic.
  let nowMs = 1_000_000;
  let timer = null;
  const timers = {
    setTimeout: (fn, ms) => {
      timer = { fn, at: nowMs + ms };
      return timer;
    },
    clearTimeout: (h) => {
      if (timer === h) timer = null;
    },
  };
  const tick = (ms) => {
    nowMs += ms;
    if (timer && timer.at <= nowMs) {
      const { fn } = timer;
      timer = null;
      fn();
    }
  };

  const p = await store.createProject({ name: 'Doc', templateKind: 'k', templateId: 't', config: { n: 0 } });
  const autosave = new AutosaveManager(store, { debounceMs: 300, timers });

  autosave.schedule(p.id, { n: 1 });
  tick(100);
  autosave.schedule(p.id, { n: 2 });
  tick(100);
  autosave.schedule(p.id, { n: 3 });
  assert.equal(autosave.isPending(p.id), true);
  assert.equal((await store.listVersions(p.id)).length, 1, 'only the create version so far');

  tick(300);
  await autosave.flush();
  assert.equal(autosave.isPending(p.id), false);
  assert.deepEqual((await store.getProject(p.id)).config, { n: 3 }, 'last edit wins');
  assert.equal((await store.listVersions(p.id)).length, 2, 'one autosave version appended');

  // Version history + restore grows history without mutating prior entries.
  await store.updateProject(p.id, { config: { n: 4 } }, 'manual bump');
  const versions = await store.listVersions(p.id);
  assert.equal(versions.length, 3);
  assert.deepEqual(versions.map((v) => v.configSnapshot), [{ n: 0 }, { n: 3 }, { n: 4 }]);
  assert.equal(versions[2].label, 'manual bump');

  const restored = await store.restoreVersion(p.id, versions[0].versionId);
  assert.deepEqual(restored.config, { n: 0 });
  const after = await store.listVersions(p.id);
  assert.equal(after.length, 4);
  assert.deepEqual(after.slice(0, 3), versions);
  assert.match(after[3].label, /restored from/);
});

test('(b) offline auth slot: deterministic local user (auth presence)', async () => {
  const backend = createOfflineBackend();
  const user = await backend.auth.getUser();
  assert.equal(user.id, 'offline-user');
  assert.equal(user.email, 'offline@localhost');
});

/**
 * @lumen/app-projects — headless tests.
 *
 * Covers ProjectStore CRUD, AutosaveManager debounce (fake timers),
 * version history immutability + restore, retention pruning and
 * import/export round-trip.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AutosaveManager,
  LocalStorageAdapter,
  MemoryStorage,
  ProjectStore,
} from '../dist/index.js';

/** Deterministic id generator factory. */
function idGen(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function makeStore(options = {}) {
  return new ProjectStore(new MemoryStorage(), { generateId: idGen(), ...options });
}

// ------------------------------------------------------------------ CRUD --

test('create/list/get/update/duplicate/delete', async () => {
  const store = makeStore();
  const p = await store.createProject({
    name: 'Demo',
    templateKind: 'viewer-3d',
    templateId: 'basic',
    config: { theme: { accent: '#fff' } },
  });
  assert.equal(p.name, 'Demo');
  assert.equal(p.schemaVersion, 1);
  assert.ok(p.id);

  assert.equal((await store.listProjects()).length, 1);
  assert.deepEqual((await store.getProject(p.id)).config, { theme: { accent: '#fff' } });
  assert.equal(await store.getProject('nope'), undefined);

  const updated = await store.updateProject(p.id, { name: 'Renamed', config: { a: 1 } });
  assert.equal(updated.name, 'Renamed');
  assert.deepEqual(updated.config, { a: 1 });
  assert.equal(updated.createdAt, p.createdAt);

  const copy = await store.duplicateProject(p.id);
  assert.notEqual(copy.id, p.id);
  assert.equal(copy.name, 'Renamed (copy)');
  assert.deepEqual(copy.config, { a: 1 });
  assert.equal((await store.listProjects()).length, 2);

  assert.equal(await store.deleteProject(copy.id), true);
  assert.equal(await store.deleteProject(copy.id), false);
  assert.equal((await store.listProjects()).length, 1);
  await assert.rejects(() => store.updateProject('nope', { name: 'x' }), /not found/);
  await assert.rejects(() => store.createProject({ name: '', templateKind: 'k', templateId: 't' }), /name is required/);
});

// -------------------------------------------------------------- autosave --

test('autosave debounces edits into a single save', async () => {
  // Fake clock + fake timers.
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

  const store = makeStore({ now: () => nowMs });
  const p = await store.createProject({ name: 'A', templateKind: 'k', templateId: 't' });
  const autosave = new AutosaveManager(store, { debounceMs: 300, timers });

  autosave.schedule(p.id, { n: 1 });
  tick(100);
  autosave.schedule(p.id, { n: 2 });
  tick(100);
  autosave.schedule(p.id, { n: 3 });
  assert.equal(autosave.isPending(p.id), true);
  // Versions so far: only the initial create.
  assert.equal((await store.listVersions(p.id)).length, 1);

  tick(300); // fire the debounce timer
  await autosave.flush();
  assert.equal(autosave.isPending(p.id), false);
  const saved = await store.getProject(p.id);
  assert.deepEqual(saved.config, { n: 3 }); // only the last edit persisted
  assert.equal((await store.listVersions(p.id)).length, 2);

  autosave.schedule(p.id, { n: 4 });
  autosave.cancel(p.id);
  await autosave.flush();
  assert.deepEqual((await store.getProject(p.id)).config, { n: 3 });
});

// ----------------------------------------------------------- versioning --

test('version history: every save appends; restore creates a new version', async () => {
  const store = makeStore();
  const p = await store.createProject({
    name: 'V', templateKind: 'k', templateId: 't', config: { v: 0 },
  });
  await store.updateProject(p.id, { config: { v: 1 } });
  await store.updateProject(p.id, { config: { v: 2 } }, 'second');

  const versions = await store.listVersions(p.id);
  assert.equal(versions.length, 3);
  assert.deepEqual(versions.map((v) => v.configSnapshot), [{ v: 0 }, { v: 1 }, { v: 2 }]);
  assert.equal(versions[2].label, 'second');

  const before = structuredClone(versions);
  const restored = await store.restoreVersion(p.id, versions[0].versionId);
  assert.deepEqual(restored.config, { v: 0 });

  const after = await store.listVersions(p.id);
  assert.equal(after.length, 4); // history grew; nothing mutated
  assert.deepEqual(after.slice(0, 3), before);
  assert.deepEqual(after[3].configSnapshot, { v: 0 });
  assert.match(after[3].label, /restored from/);

  await assert.rejects(() => store.restoreVersion(p.id, 'missing'), /version not found/);
  await assert.rejects(() => store.restoreVersion('nope', 'x'), /project not found/);
});

test('retention: oldest versions pruned beyond maxVersions', async () => {
  const store = makeStore({ maxVersions: 5 });
  const p = await store.createProject({ name: 'R', templateKind: 'k', templateId: 't', config: { v: 0 } });
  for (let i = 1; i <= 9; i++) {
    await store.updateProject(p.id, { config: { v: i } });
  }
  const versions = await store.listVersions(p.id);
  assert.equal(versions.length, 5);
  assert.deepEqual(versions.map((v) => v.configSnapshot.v), [5, 6, 7, 8, 9]);
});

// ---------------------------------------------------------- import/export --

test('export/import round-trip with new id assignment', async () => {
  const store = makeStore();
  const p = await store.createProject({
    name: 'Portable', templateKind: 'viewer-3d', templateId: 'basic', config: { x: 42 },
  });
  await store.updateProject(p.id, { config: { x: 43 } }, 'bump');

  const json = await store.exportProject(p.id);
  const env = JSON.parse(json);
  assert.equal(env.formatVersion, 1);
  assert.equal(env.versions.length, 2);

  const imported = await store.importProject(json);
  assert.notEqual(imported.id, p.id); // collision-safe
  assert.equal(imported.name, 'Portable');
  assert.deepEqual(imported.config, { x: 43 });
  const versions = await store.listVersions(imported.id);
  // 2 imported history entries + 1 "imported" entry; all point at the new id.
  assert.equal(versions.length, 3);
  assert.ok(versions.every((v) => v.projectId === imported.id));

  assert.equal((await store.listProjects()).length, 2);

  await assert.rejects(() => store.importProject('not json'), /invalid JSON/);
  await assert.rejects(() => store.importProject('{"formatVersion":99}'), /unsupported formatVersion/);
  await assert.rejects(
    () => store.importProject(JSON.stringify({ formatVersion: 1, project: { id: 1 } })),
    /failed validation/,
  );
});

// -------------------------------------------------------------- adapters --

test('LocalStorageAdapter guards non-browser environments', async () => {
  assert.equal(LocalStorageAdapter.isAvailable(), false);
  const adapter = new LocalStorageAdapter();
  await assert.rejects(() => adapter.loadAll(), /localStorage is not available/);
});

test('MemoryStorage is the default adapter', async () => {
  const store = new ProjectStore();
  const p = await store.createProject({ name: 'D', templateKind: 'k', templateId: 't' });
  assert.equal((await store.getProject(p.id)).name, 'D');
});

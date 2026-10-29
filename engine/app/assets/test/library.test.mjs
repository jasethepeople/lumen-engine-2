/**
 * AssetLibrary CRUD + storage-adapter persistence tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetLibrary, DEFAULT_STORAGE_KEY, HybridManifestGenerator } from '../dist/index.js';

function manifest(name = 'hero') {
  return new HybridManifestGenerator().generate({ name, scrubBytes: new Uint8Array([1, 2]) });
}

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('in-memory CRUD: put/get/list/delete/clear', () => {
  let tick = 0;
  const lib = new AssetLibrary({ now: () => new Date(1700000000000 + tick++ * 1000).toISOString() });
  const rec = lib.put({ assetId: 'a1', name: 'hero', manifest: manifest(), deviceProfiles: ['desktop'] });
  assert.ok(rec.createdAt.endsWith('Z'));
  lib.put({ assetId: 'a2', name: 'loop', manifest: manifest('loop'), deviceProfiles: ['mobile', 'low-power'] });

  assert.equal(lib.size, 2);
  assert.equal(lib.get('a1').name, 'hero');
  assert.deepEqual(lib.get('a2').deviceProfiles, ['mobile', 'low-power']);
  assert.deepEqual(lib.list().map((r) => r.assetId), ['a1', 'a2']); // sorted by createdAt

  assert.equal(lib.delete('a1'), true);
  assert.equal(lib.delete('a1'), false);
  assert.equal(lib.get('a1'), undefined);
  lib.clear();
  assert.equal(lib.size, 0);
});

test('put replaces an existing assetId', () => {
  const lib = new AssetLibrary();
  lib.put({ assetId: 'x', name: 'v1', manifest: manifest(), deviceProfiles: [] });
  lib.put({ assetId: 'x', name: 'v2', manifest: manifest(), deviceProfiles: [] });
  assert.equal(lib.size, 1);
  assert.equal(lib.get('x').name, 'v2');
});

test('storage adapter: records persist and reload into a fresh instance', () => {
  const storage = memoryStorage();
  const lib = new AssetLibrary({ storage });
  lib.put({ assetId: 'p1', name: 'persisted', manifest: manifest(), deviceProfiles: ['desktop'] });
  assert.ok(storage.map.has(DEFAULT_STORAGE_KEY));

  const reloaded = new AssetLibrary({ storage });
  assert.equal(reloaded.size, 1);
  assert.equal(reloaded.get('p1').name, 'persisted');
  reloaded.delete('p1');
  const third = new AssetLibrary({ storage });
  assert.equal(third.size, 0);
});

test('corrupt storage payload is ignored, not fatal', () => {
  const storage = memoryStorage();
  storage.map.set(DEFAULT_STORAGE_KEY, '{not json');
  const lib = new AssetLibrary({ storage });
  assert.equal(lib.size, 0);
  lib.put({ assetId: 'ok', name: 'ok', manifest: manifest(), deviceProfiles: [] });
  assert.equal(lib.size, 1);
});

test('throwing storage (quota/privacy mode) keeps the library functional', () => {
  const hostile = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => {},
  };
  const lib = new AssetLibrary({ storage: hostile });
  lib.put({ assetId: 'm', name: 'mem', manifest: manifest(), deviceProfiles: [] });
  assert.equal(lib.get('m').name, 'mem');
  assert.equal(lib.list().length, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache, PersistentCache, AssetCache } from '../dist/cache.js';

test('LRU evicts the least-recently-used entry past maxEntries', () => {
  const lru = new LruCache(2);
  lru.set('a', 1);
  lru.set('b', 2);
  lru.get('a'); // refresh a; b is now LRU
  lru.set('c', 3);
  assert.equal(lru.has('b'), false);
  assert.equal(lru.get('a'), 1);
  assert.equal(lru.get('c'), 3);
});

test('LRU get refreshes recency order', () => {
  const lru = new LruCache(3);
  lru.set('a', 1);
  lru.set('b', 2);
  lru.set('c', 3);
  lru.get('a');
  assert.equal(lru.lruKey(), 'b');
});

test('LRU respects a byte budget via sizeOf', () => {
  const lru = new LruCache(100, 10, (v) => v.byteLength);
  lru.set('a', new ArrayBuffer(6));
  lru.set('b', new ArrayBuffer(6)); // exceeds 10 total → evicts 'a'
  assert.equal(lru.has('a'), false);
  assert.equal(lru.bytes, 6);
});

test('LRU overwrite of a key adjusts byte accounting', () => {
  const lru = new LruCache(10, 100, (v) => v.byteLength);
  lru.set('a', new ArrayBuffer(10));
  lru.set('a', new ArrayBuffer(20));
  assert.equal(lru.size, 1);
  assert.equal(lru.bytes, 20);
});

test('LRU delete and clear', () => {
  const lru = new LruCache(4);
  lru.set('a', 1);
  assert.equal(lru.delete('a'), true);
  assert.equal(lru.delete('a'), false);
  lru.set('b', 2);
  lru.clear();
  assert.equal(lru.size, 0);
});

test('PersistentCache degrades to a safe no-op under Node', async () => {
  const p = new PersistentCache();
  assert.equal(p.supported, false);
  await p.set('k', new ArrayBuffer(4));
  assert.equal(await p.get('k'), undefined);
  await p.clear(); // must not throw
});

test('AssetCache memory tier round-trips under Node', async () => {
  const cache = new AssetCache({ maxEntries: 4 });
  const bytes = new TextEncoder().encode('hello').buffer;
  await cache.set('image:abc', bytes);
  const hit = await cache.get('image:abc');
  assert.ok(hit);
  assert.equal(new TextDecoder().decode(hit), 'hello');
  assert.equal(cache.memory.size, 1);
  await cache.clear();
  assert.equal(await cache.get('image:abc'), undefined);
});

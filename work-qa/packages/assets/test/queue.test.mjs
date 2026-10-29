import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssetPriorityQueue, buildQueue } from '../dist/preload.js';
import { normalizeManifest } from '../dist/manifest.js';
import { FIXTURE_MANIFEST } from './fixtures.mjs';

const entry = (preload) => ({ kind: 'lottie', id: '', preload, bytes: 1, url: '/x.json', duration: 1, frameRate: 60 });

test('priority queue dequeues critical before eager before lazy', () => {
  const q = new AssetPriorityQueue();
  q.push('z-lazy', entry('lazy'));
  q.push('b-eager', entry('eager'));
  q.push('a-critical', entry('critical'));
  q.push('c-lazy', entry('lazy'));
  const order = [];
  let item;
  while ((item = q.shift())) order.push(item.id);
  assert.deepEqual(order, ['a-critical', 'b-eager', 'c-lazy', 'z-lazy']);
});

test('ties within a priority break by id (deterministic)', () => {
  const q = new AssetPriorityQueue();
  q.push('delta', entry('eager'));
  q.push('alpha', entry('eager'));
  q.push('charlie', entry('eager'));
  assert.equal(q.shift().id, 'alpha');
  assert.equal(q.shift().id, 'charlie');
  assert.equal(q.shift().id, 'delta');
  assert.equal(q.shift(), undefined);
});

test('buildQueue from manifest orders by priority then id', () => {
  const q = buildQueue(normalizeManifest(FIXTURE_MANIFEST));
  const order = [];
  let item;
  while ((item = q.shift())) order.push(item.id);
  assert.deepEqual(order, ['bodyFont', 'hero', 'chair', 'intro', 'logo', 'theme']);
});

test('buildQueue can restrict to a subset of ids', () => {
  const q = buildQueue(normalizeManifest(FIXTURE_MANIFEST), ['theme', 'hero']);
  assert.equal(q.size, 2);
  assert.equal(q.shift().id, 'hero'); // critical first even though theme listed first
  assert.equal(q.shift().id, 'theme');
});

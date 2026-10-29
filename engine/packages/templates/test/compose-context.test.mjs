/**
 * P10 — per-compose id context: isolated contexts never interleave ids;
 * legacy nextId()/resetIds() wrappers behave exactly as before.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createComposeContext } from '../dist/index.js';
import { nextId, resetIds } from '../dist/internal.js';

test('two explicit contexts interleaved produce non-interleaved ids', () => {
  const a = createComposeContext();
  const b = createComposeContext();
  const seq = [a.nextId('n'), b.nextId('n'), a.nextId('n'), b.nextId('n')];
  assert.deepEqual(seq, ['n-1', 'n-1', 'n-2', 'n-2']);
});

test('context seed offsets the counter', () => {
  const ctx = createComposeContext(41);
  assert.equal(ctx.seed, 41);
  assert.equal(ctx.nextId('x'), 'x-42');
});

test('legacy resetIds()+nextId() sequence unchanged', () => {
  resetIds();
  assert.equal(nextId('a'), 'a-1');
  assert.equal(nextId('a'), 'a-2');
  resetIds();
  assert.equal(nextId('b'), 'b-1');
});

test('default context is isolated from explicit contexts', () => {
  resetIds();
  const ctx = createComposeContext();
  ctx.nextId('c');
  ctx.nextId('c');
  assert.equal(nextId('d'), 'd-1');
});

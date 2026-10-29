import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventBus } from '../dist/index.js';

test('on/emit delivers typed payloads', () => {
  const bus = createEventBus();
  const seen = [];
  bus.on('lifecycle:change', (p) => seen.push(p));
  bus.emit('lifecycle:change', { from: 'created', to: 'booting' });
  assert.deepEqual(seen, [{ from: 'created', to: 'booting' }]);
});

test('unsubscribe stops delivery', () => {
  const bus = createEventBus();
  let count = 0;
  const off = bus.on('timeline:seek', () => count++);
  bus.emit('timeline:seek', { time: 1, source: 'user' });
  off();
  bus.emit('timeline:seek', { time: 2, source: 'user' });
  assert.equal(count, 1);
});

test('once fires exactly once', () => {
  const bus = createEventBus();
  let count = 0;
  bus.once('asset:progress', () => count++);
  bus.emit('asset:progress', { loaded: 1, total: 2 });
  bus.emit('asset:progress', { loaded: 2, total: 2 });
  assert.equal(count, 1);
});

test('off removes a specific handler', () => {
  const bus = createEventBus();
  let a = 0;
  let b = 0;
  const ha = () => a++;
  bus.on('engine:error', ha);
  bus.on('engine:error', () => b++);
  bus.off('engine:error', ha);
  bus.emit('engine:error', { module: 'x', code: 'Y', recoverable: true });
  assert.equal(a, 0);
  assert.equal(b, 1);
});

test('wildcard listeners receive every event with its name', () => {
  const bus = createEventBus();
  const seen = [];
  bus.onAny((event, payload) => seen.push([event, payload]));
  bus.emit('lifecycle:enter', { phase: 'ready' });
  bus.emit('timeline:seek', { time: 5, source: 'programmatic' });
  assert.deepEqual(seen, [
    ['lifecycle:enter', { phase: 'ready' }],
    ['timeline:seek', { time: 5, source: 'programmatic' }],
  ]);
});

test('a throwing listener is isolated and reported, emit continues', () => {
  const errors = [];
  const bus = createEventBus({ onListenerError: (e, ev) => errors.push([e, ev]) });
  const calls = [];
  bus.on('lifecycle:enter', () => {
    throw new Error('boom');
  });
  bus.on('lifecycle:enter', () => calls.push('second'));
  assert.doesNotThrow(() => bus.emit('lifecycle:enter', { phase: 'active' }));
  assert.deepEqual(calls, ['second']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0].message, 'boom');
  assert.equal(errors[0][1], 'lifecycle:enter');
});

test('listenerCount and clear', () => {
  const bus = createEventBus();
  bus.on('engine:error', () => {});
  bus.onAny(() => {});
  assert.equal(bus.listenerCount('engine:error'), 1);
  assert.equal(bus.listenerCount(), 2);
  bus.clear();
  assert.equal(bus.listenerCount(), 0);
});

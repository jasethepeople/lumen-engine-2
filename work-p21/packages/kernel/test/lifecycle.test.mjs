import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventBus, createLifecycle, isEngineError } from '../dist/index.js';

function make() {
  const bus = createEventBus();
  const events = [];
  bus.onAny((event, payload) => events.push([event, payload]));
  return { bus, lifecycle: createLifecycle(bus), events };
}

test('happy path transitions created → booting → loading → ready → active', () => {
  const { lifecycle, events } = make();
  assert.equal(lifecycle.phase, 'created');
  lifecycle.transition('booting');
  lifecycle.transition('loading');
  lifecycle.transition('ready');
  lifecycle.transition('active');
  assert.equal(lifecycle.phase, 'active');
  const changes = events.filter(([e]) => e === 'lifecycle:change');
  assert.deepEqual(changes.map(([, p]) => [p.from, p.to]), [
    ['created', 'booting'],
    ['booting', 'loading'],
    ['loading', 'ready'],
    ['ready', 'active'],
  ]);
});

test('emits enter/leave aliases around each change', () => {
  const { lifecycle, events } = make();
  lifecycle.transition('booting');
  assert.deepEqual(
    events.map(([e]) => e),
    ['lifecycle:change', 'lifecycle:leave', 'lifecycle:enter'],
  );
  assert.deepEqual(events[1][1], { phase: 'created' });
  assert.deepEqual(events[2][1], { phase: 'booting' });
});

test('active ⇄ paused, and any non-disposed phase can dispose', () => {
  const { lifecycle } = make();
  lifecycle.transition('booting');
  lifecycle.transition('loading');
  lifecycle.transition('ready');
  lifecycle.transition('active');
  lifecycle.transition('paused');
  lifecycle.transition('active');
  lifecycle.transition('disposed');
  assert.equal(lifecycle.phase, 'disposed');
});

test('illegal transitions throw a structured EngineError and do not move state', () => {
  const { lifecycle } = make();
  assert.throws(() => lifecycle.transition('active'), (err) => {
    assert.ok(isEngineError(err));
    assert.equal(err.code, 'INVALID_LIFECYCLE_TRANSITION');
    assert.equal(err.recoverable, true);
    return true;
  });
  assert.equal(lifecycle.phase, 'created');
});

test('disposed is terminal', () => {
  const { lifecycle } = make();
  lifecycle.transition('disposed');
  assert.equal(lifecycle.canTransition('booting'), false);
  assert.throws(() => lifecycle.transition('booting'));
});

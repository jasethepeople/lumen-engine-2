/**
 * @lumen/app-telemetry — headless Node tests.
 *
 * Covers: opt-in default-off gating, track/flush, ring-buffer eviction,
 * prop sanitization (forbidden keys stripped, coercion, truncation),
 * sink error swallowing + stats(), query filters, export/clear, and the
 * LocalStorageSink non-browser guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TelemetryClient,
  MemorySink,
  LocalStorageSink,
  LOCALSTORAGE_KEY,
  sanitizeProps,
} from '../dist/index.js';

function makeClient(opts = {}) {
  let tick = 1000;
  return new TelemetryClient({
    clock: () => (tick += 10),
    rng: (() => { let i = 0; return () => (i += 1) / 1000; })(),
    ...opts,
  });
}

test('opt-in: disabled by default — track() records nothing', () => {
  const c = makeClient();
  assert.equal(c.enabled, false);
  c.track('builder.project.created', { foo: 1 });
  c.flush();
  assert.equal(c.stats().recorded, 0);
  assert.equal(c.query().length, 0);
  assert.equal(c.exportEvents(), '[]');
});

test('setEnabled(true) enables recording with session id and props', () => {
  const c = makeClient();
  c.setEnabled(true);
  c.track('builder.project.created', { name: 'demo', count: 3, ok: true });
  const events = c.query();
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'builder.project.created');
  assert.deepEqual(events[0].props, { name: 'demo', count: 3, ok: true });
  assert.equal(events[0].sessionId, c.sessionId);
  assert.ok(events[0].id);
  assert.equal(c.stats().recorded, 1);
});

test('setEnabled(false) after enabling stops recording again', () => {
  const c = makeClient({ enabled: true });
  c.track('a.b');
  c.setEnabled(false);
  c.track('a.c');
  assert.equal(c.query().length, 1);
});

test('ring-buffer evicts oldest events beyond maxEvents', () => {
  const c = makeClient({ enabled: true, maxEvents: 3 });
  for (let i = 0; i < 5; i++) c.track(`ev.${i}`);
  const names = c.query().map((e) => e.name);
  assert.deepEqual(names, ['ev.2', 'ev.3', 'ev.4']);
  const s = c.stats();
  assert.equal(s.recorded, 5);
  assert.equal(s.retained, 3);
  assert.equal(s.evicted, 2);
  assert.equal(s.maxEvents, 3);
});

test('sanitization: forbidden keys stripped (password/token/secret/email, case-insensitive)', () => {
  const out = sanitizeProps({
    password: 'x',
    apiToken: 'y',
    USER_SECRET: 'z',
    contactEmail: 'a@b.c',
    safe: 'kept',
  });
  assert.deepEqual(out, { safe: 'kept' });
});

test('sanitization: strings over 200 chars truncated, non-primitives coerced', () => {
  const long = 'x'.repeat(250);
  const c = makeClient({ enabled: true });
  c.track('t', { long, obj: { a: 1 }, nil: null, nan: NaN });
  const props = c.query()[0].props;
  assert.equal(props.long.length, 200);
  assert.equal(typeof props.obj, 'string');
  assert.equal('nil' in props, false);
  assert.equal('nan' in props, false);
});

test('sink errors are swallowed and counted in stats().sinkErrors', () => {
  const badSink = {
    append() { throw new Error('boom'); },
    query() { throw new Error('boom'); },
    exportAll() { throw new Error('boom'); },
    clear() { throw new Error('boom'); },
    size() { throw new Error('boom'); },
  };
  const c = makeClient({ enabled: true, sink: badSink });
  assert.doesNotThrow(() => {
    c.track('x.y');
    c.flush();
    c.query();
    c.exportEvents();
    c.clear();
    c.stats();
  });
  assert.equal(c.exportEvents(), '[]');
  assert.ok(c.stats().sinkErrors >= 4);
});

test('query filters by name prefix and time range (inclusive)', () => {
  const c = makeClient({ enabled: true });
  c.track('builder.project.created'); // ts 1010
  c.track('builder.project.opened'); // ts 1020
  c.track('publish.started'); // ts 1030
  assert.equal(c.query({ namePrefix: 'builder.' }).length, 2);
  assert.equal(c.query({ namePrefix: 'builder.project.' }).length, 2);
  assert.equal(c.query({ namePrefix: 'publish.' }).length, 1);
  assert.equal(c.query({ from: 1020 }).length, 2);
  assert.equal(c.query({ to: 1020 }).length, 2);
  assert.equal(c.query({ from: 1010, to: 1020 }).length, 2);
  assert.equal(c.query({ namePrefix: 'builder.', to: 1010 }).length, 1);
  assert.equal(c.query({ namePrefix: 'missing.' }).length, 0);
});

test('exportEvents returns JSON of retained events; clear() empties', () => {
  const c = makeClient({ enabled: true });
  c.track('a', { k: 'v' });
  c.track('b');
  const parsed = JSON.parse(c.exportEvents());
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'a');
  c.clear();
  assert.equal(c.query().length, 0);
  assert.equal(JSON.parse(c.exportEvents()).length, 0);
});

test('MemorySink honors capacity and exposes evictedCount', () => {
  const sink = new MemorySink(2);
  sink.append({ id: '1', name: 'a', ts: 1, sessionId: 's' });
  sink.append({ id: '2', name: 'b', ts: 2, sessionId: 's' });
  sink.append({ id: '3', name: 'c', ts: 3, sessionId: 's' });
  assert.equal(sink.size(), 2);
  assert.equal(sink.evictedCount, 1);
  assert.equal(sink.exportAll()[0].id, '2');
});

test('LocalStorageSink: guarded in non-browser (errors swallowed by client)', () => {
  const c = makeClient({ enabled: true, sink: new LocalStorageSink(10) });
  assert.doesNotThrow(() => c.track('x'));
  assert.equal(c.query().length, 0);
  assert.ok(c.stats().sinkErrors >= 1);
});

test('LocalStorageSink: works against a localStorage-compatible shim', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
  };
  try {
    const sink = new LocalStorageSink(2);
    const c = makeClient({ enabled: true, sink });
    c.track('a');
    c.track('b');
    c.track('c');
    assert.equal(sink.size(), 2);
    assert.equal(c.query({ namePrefix: 'a' }).length, 0); // evicted
    const persisted = JSON.parse(store.get(LOCALSTORAGE_KEY));
    assert.equal(persisted.length, 2);
    assert.equal(persisted[0].name, 'b');
    c.clear();
    assert.equal(store.has(LOCALSTORAGE_KEY), false);
  } finally {
    delete globalThis.localStorage;
  }
});

test('deterministic injectable rng/clock give reproducible ids and timestamps', () => {
  const a = makeClient({ enabled: true });
  const b = makeClient({ enabled: true });
  a.track('x');
  b.track('x');
  assert.equal(a.query()[0].id, b.query()[0].id);
  assert.equal(a.query()[0].ts, b.query()[0].ts);
  assert.equal(a.sessionId, b.sessionId);
});

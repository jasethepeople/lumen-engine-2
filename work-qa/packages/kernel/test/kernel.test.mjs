import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createKernel,
  createScheduler,
  detectCapabilities,
  resolvePluginOrder,
} from '../dist/index.js';

const fakeCaps = Object.freeze({
  webgl2: false,
  webgpu: false,
  offscreenCanvas: false,
  codecs: Object.freeze({
    h264: Object.freeze({ supported: true, smooth: true, powerEfficient: true }),
    hevc: Object.freeze({ supported: false, smooth: false, powerEfficient: false }),
    av1: Object.freeze({ supported: false, smooth: false, powerEfficient: false }),
    vp9: Object.freeze({ supported: false, smooth: false, powerEfficient: false }),
  }),
  maxTextureSize: 0,
  deviceMemoryGB: null,
  reducedMotion: false,
  dpr: Object.freeze({ min: 1, max: 2, current: 1 }),
});

// Deterministic manual frame source: start() must not hang without rAF.
const manualFrames = () => {
  let cbs = [];
  return {
    requestFrame: (cb) => (cbs.push(cb), cbs.length),
    cancelFrame: () => (cbs = []),
  };
};

test('boot runs the full lifecycle and initializes plugins in dependency order', async () => {
  const frames = manualFrames();
  const kernel = createKernel({
    capabilities: fakeCaps,
    scheduler: { requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame },
  });

  const initOrder = [];
  kernel.registerPlugin({
    name: 'consumer',
    version: '1.0.0',
    consumes: ['renderer:canvas'],
    init: () => initOrder.push('consumer'),
    dispose: () => {},
  });
  kernel.registerPlugin({
    name: 'provider',
    version: '1.0.0',
    provides: ['renderer:canvas'],
    init: () => initOrder.push('provider'),
    dispose: () => {},
  });

  const phases = [];
  kernel.on('lifecycle:enter', ({ phase }) => phases.push(phase));

  await kernel.boot();
  assert.deepEqual(initOrder, ['provider', 'consumer']);
  assert.deepEqual(phases, ['booting', 'loading', 'ready', 'active']);
  assert.equal(kernel.phase, 'active');
  assert.equal(kernel.capabilities.webgl2, false);

  kernel.suspend();
  assert.equal(kernel.phase, 'paused');
  kernel.resume();
  assert.equal(kernel.phase, 'active');

  await kernel.dispose();
  assert.equal(kernel.phase, 'disposed');
});

test('plugin init failure is reported via engine:error and rejects start()', async () => {
  const kernel = createKernel({
    capabilities: fakeCaps,
    scheduler: { requestFrame: () => 0, cancelFrame: () => {} },
  });
  const errors = [];
  kernel.on('engine:error', (e) => errors.push(e));
  kernel.registerPlugin({
    name: 'bad',
    version: '0.0.1',
    init: () => {
      throw new Error('init boom');
    },
    dispose: () => {},
  });
  await assert.rejects(kernel.start(), (err) => err && err.code === 'PLUGIN_INIT_FAILED');
  assert.notEqual(kernel.phase, 'active');
  // initAll reports PLUGIN_INIT_FAILED; start()'s boundary adds BOOT_FAILED.
  assert.equal(errors.length, 2);
  assert.equal(errors[0].module, 'bad');
  assert.equal(errors[0].code, 'PLUGIN_INIT_FAILED');
});

test('resolvePluginOrder rejects missing dependencies and cycles', () => {
  const missing = [
    { name: 'a', version: '1', consumes: ['nope'], init() {}, dispose() {} },
  ];
  assert.throws(
    () => resolvePluginOrder(missing),
    (err) => err.code === 'PLUGIN_MISSING_DEPENDENCY',
  );

  const cycle = [
    { name: 'a', version: '1', provides: ['t:a'], consumes: ['t:b'], init() {}, dispose() {} },
    { name: 'b', version: '1', provides: ['t:b'], consumes: ['t:a'], init() {}, dispose() {} },
  ];
  assert.throws(
    () => resolvePluginOrder(cycle),
    (err) => err.code === 'PLUGIN_CYCLE',
  );
});

test('scheduler enforces budget and drives adaptive degradation', () => {
  const reports = [];
  let degrades = 0;
  let time = 0;
  const scheduler = createScheduler({
    now: () => time,
    budgetMs: 10,
    degradeAfterFrames: 2,
    onBudgetExceeded: (r) => reports.push(r),
    onDegrade: () => {
      degrades++;
      return 20;
    },
  });
  scheduler.register(() => {
    time += 15; // every frame overruns the 10ms budget
  }, { phase: 'render', priority: 10 });

  scheduler.tick(0);
  scheduler.tick(16);
  assert.equal(reports.length, 2);
  assert.equal(reports[0].phase, 'render');
  assert.equal(reports[0].budgetMs, 10);
  assert.equal(degrades, 1);
  assert.equal(scheduler.budgetMs, 20); // adapted by the hook

  scheduler.tick(32); // 15ms < 20ms budget now
  assert.equal(reports.length, 2);
});

test('scheduler runs callbacks in priority order and isolates task errors', () => {
  const order = [];
  const taskErrors = [];
  const scheduler = createScheduler({ onTaskError: (e, p) => taskErrors.push(p) });
  scheduler.register(() => order.push('render'), { priority: 30, phase: 'render' });
  scheduler.register(() => {
    throw new Error('input boom');
  }, { priority: 0, phase: 'input' });
  scheduler.register(() => order.push('timeline'), { priority: 10, phase: 'timeline' });
  scheduler.tick(0);
  assert.deepEqual(order, ['timeline', 'render']);
  assert.deepEqual(taskErrors, ['input']);
});

test('detectCapabilities falls back safely with no DOM globals', async () => {
  const profile = await detectCapabilities({});
  assert.equal(profile.webgl2, false);
  assert.equal(profile.webgpu, false);
  assert.equal(profile.codecs.vp9.supported, false);
  assert.equal(profile.dpr.current, 1);
});

test('detectCapabilities uses injected environment', async () => {
  const profile = await detectCapabilities({
    navigator: {
      deviceMemory: 8,
      gpu: {},
      mediaCapabilities: {
        decodingInfo: async () => ({ supported: true, smooth: true, powerEfficient: false }),
      },
    },
    window: {
      devicePixelRatio: 2,
      matchMedia: () => ({ matches: true }),
    },
    document: {
      createElement: () => ({
        getContext: () => ({ getParameter: () => 16384 }),
      }),
    },
    OffscreenCanvas: class {},
  });
  assert.equal(profile.webgl2, true);
  assert.equal(profile.webgpu, true);
  assert.equal(profile.offscreenCanvas, true);
  assert.equal(profile.maxTextureSize, 16384);
  assert.equal(profile.deviceMemoryGB, 8);
  assert.equal(profile.reducedMotion, true);
  assert.equal(profile.dpr.current, 2);
  assert.equal(profile.codecs.h264.supported, true);
});

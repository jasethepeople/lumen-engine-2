/**
 * QA regression (FB1/FB3/FB4): generated modules fail loudly, carry the
 * import map, mobile viewport fixes, and the webcomponent boots safely.
 *
 * Run: `node --test test/qa-regression.test.mjs` (after package build).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generate } from '../dist/index.js';
import { makeConfig, makeDescriptor, makeOptions, makeScene } from './fixtures.mjs';

test('static index.html carries an import map for @lumen/* + viewport-fit=cover', () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('static'));
  const html = res.files.find((f) => f.path === 'index.html').source;
  const m = html.match(/<script type="importmap">([^<]+)<\/script>/);
  assert.ok(m, 'import map emitted');
  const { imports } = JSON.parse(m[1]);
  assert.equal(imports['@lumen/runtime'], './vendor/runtime/index.js');
  assert.ok(imports['@lumen/kernel'], 'transitive runtime packages covered');
  assert.ok(html.includes('viewport-fit=cover'));
  assert.ok(html.includes('100dvh'), 'dynamic viewport fallback in critical CSS');
  assert.ok(html.includes('touch-action:pan-y'));
});

test('static entry catches boot failures with a visible fallback + DOM event', () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('static', { minify: false }));
  const main = res.files.find((f) => f.path === 'main.ts').source;
  assert.ok(main.includes('void main().catch(reportBootError)'));
  assert.ok(main.includes('role="alert"'));
  assert.ok(main.includes("lumen:boot-error"));
  assert.ok(main.includes("engine.on('engine:error'"));
});

test('runtime target auto-boot catches failures', () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('runtime', { minify: false }));
  const loader = res.files.find((f) => f.path === 'loader.ts').source;
  assert.ok(loader.includes('void loadLumen(autoUrl).catch('));
  assert.ok(loader.includes('role="alert"'));
  assert.ok(loader.includes("lumen:boot-error"));
});

test('webcomponent boots with a generation token and disposes before reboot', () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('webcomponent', { minify: false }));
  const mod = res.files.find((f) => f.path === 'lumen-embed.ts').source;
  assert.ok(mod.includes('bootGen'), 'generation token present');
  assert.ok(mod.includes('const previous = this.engine;'), 'dispose-before-reboot');
  assert.ok(mod.includes('await previous?.dispose?.();'));
  assert.ok(mod.includes('gen !== this.bootGen'), 'stale boot dropped');
  assert.ok(mod.includes("lumen:boot-error"));
});

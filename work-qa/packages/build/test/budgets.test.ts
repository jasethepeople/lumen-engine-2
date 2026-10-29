import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ArtifactFile } from '@lumen/contracts';

import {
  DEFAULT_BUDGETS,
  checkBudgets,
  gzipSize,
  measureMetric,
} from '../src/budgets.js';

function jsFile(path: string, gzipBytes: number, bytes = gzipBytes * 3): ArtifactFile {
  return { path, bytes, gzipBytes, hash: 'x', role: 'chunk' };
}

test('gzipSize returns deterministic positive size', () => {
  const a = gzipSize('const x = 1;');
  assert.ok(a > 0);
  assert.equal(a, gzipSize('const x = 1;'));
});

test('measureMetric sums js gz, css gz, and asset bytes', () => {
  const files: ArtifactFile[] = [
    jsFile('entry.aaa.js', 100),
    jsFile('chunk.bbb.js', 50),
    { path: 'styles.css', bytes: 200, gzipBytes: 80, hash: 'x', role: 'chunk' },
    { path: 'assets/hero.webp', bytes: 5000, gzipBytes: 4900, hash: 'x', role: 'asset' },
  ];
  assert.equal(measureMetric('js-gz', files), 150);
  assert.equal(measureMetric('css-gz', files), 80);
  assert.equal(measureMetric('critical-assets', files), 5000);
  assert.equal(measureMetric('first-frame-ms', files), null);
});

test('budgets pass when under threshold', () => {
  const files = [jsFile('entry.js', 1000)];
  const { report, outcomes } = checkBudgets(files, [
    { metric: 'js-gz', budget: 2000 },
  ]);
  assert.equal(report.passed, true);
  assert.equal(outcomes[0].status, 'pass');
});

test('budgets warn when slightly over, fail beyond tolerance', () => {
  const warnFiles = [jsFile('entry.js', 1050)]; // 105% of 1000
  const failFiles = [jsFile('entry.js', 1200)]; // 120%
  const warn = checkBudgets(warnFiles, [{ metric: 'js-gz', budget: 1000 }]);
  const fail = checkBudgets(failFiles, [{ metric: 'js-gz', budget: 1000 }]);
  assert.equal(warn.outcomes[0].status, 'warn');
  assert.equal(warn.report.passed, true); // warn does not fail the gate
  assert.equal(fail.outcomes[0].status, 'fail');
  assert.equal(fail.report.passed, false);
});

test('runtime metrics are skipped unless measured externally', () => {
  const files = [jsFile('entry.js', 10)];
  const skipped = checkBudgets(files, [{ metric: 'lighthouse-a11y', budget: 95 }]);
  assert.equal(skipped.outcomes[0].status, 'skipped');
  assert.ok(skipped.notes.length > 0);

  // higher-is-better score metric: 96 passes, 90 warns, 80 fails.
  const passing = checkBudgets(files, [{ metric: 'lighthouse-a11y', budget: 95 }], {
    measured: { 'lighthouse-a11y': 96 },
  });
  assert.equal(passing.outcomes[0].status, 'pass');
  const warning = checkBudgets(files, [{ metric: 'lighthouse-a11y', budget: 95 }], {
    measured: { 'lighthouse-a11y': 90 },
  });
  assert.equal(warning.outcomes[0].status, 'warn');
  const failing = checkBudgets(files, [{ metric: 'lighthouse-a11y', budget: 95 }], {
    measured: { 'lighthouse-a11y': 80 },
  });
  assert.equal(failing.outcomes[0].status, 'fail');
  assert.equal(failing.report.passed, false);
});

test('DEFAULT_BUDGETS reflect architecture values', () => {
  const js = DEFAULT_BUDGETS.find((b) => b.metric === 'js-gz');
  const assets = DEFAULT_BUDGETS.find((b) => b.metric === 'critical-assets');
  assert.equal(js?.budget, 170 * 1024);
  assert.equal(assets?.budget, 1228800);
});

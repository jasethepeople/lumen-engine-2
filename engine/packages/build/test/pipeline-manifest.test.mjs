/**
 * Deploy manifest hardening: manifest.json carries generatedAt plus the
 * additive engineVersion stamp. Run after `bash scripts/build-all.sh`:
 * `node --test test/pipeline-manifest.test.mjs`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { LUMEN_ENGINE_VERSION, runPipeline } from '../dist/index.js';

function fakeGenerate() {
  return () => ({
    entry: 'main.js',
    files: [{ path: 'main.js', source: 'export {};\n', imports: [] }],
    hydrationManifest: { islands: [] },
    typeDeclarations: '',
    ssrHtml: '',
    importGraph: [],
    warnings: [],
  });
}

test('manifest.json gains engineVersion alongside generatedAt', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'lumen-manifest-'));
  const artifact = await runPipeline(
    { target: 'webcomponent', minify: false },
    fakeGenerate(),
    { outDir, clean: false },
  );
  assert.ok(artifact);
  const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.engineVersion, LUMEN_ENGINE_VERSION);
  assert.equal(typeof manifest.generatedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(manifest.generatedAt)));
});

test('ctx.engineVersion overrides the stamp', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'lumen-manifest-'));
  await runPipeline({ target: 'webcomponent', minify: false }, fakeGenerate(), {
    outDir,
    clean: false,
    engineVersion: '9.9.9-test',
  });
  const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.engineVersion, '9.9.9-test');
});

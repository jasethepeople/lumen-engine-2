/**
 * QA regression (FB1): runtime vendoring for the 'static' target.
 *
 * Runnable directly against compiled dists: `node --test test/vendor.test.mjs`
 * (requires `bash scripts/build-all.sh` to have run so node_modules/@lumen
 * shims and package dists exist).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { build, RUNTIME_VENDOR_PACKAGES } from '../dist/index.js';

function fakeGenerate() {
  return {
    entry: 'entry.js',
    files: [
      {
        path: 'entry.js',
        source: `import { bootEngine } from '@lumen/runtime';\nconsole.log(bootEngine);\n`,
        imports: ['@lumen/runtime'],
      },
    ],
    hydrationManifest: { islands: [] },
    typeDeclarations: '',
    ssrHtml: '',
    importGraph: [],
    warnings: [],
  };
}

async function* walkJs(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJs(abs);
    else if (entry.name.endsWith('.js')) yield abs;
  }
}

test('static target vendors runtime packages into <outDir>/vendor', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'lumen-vendor-'));
  try {
    const artifact = await build(
      { target: { target: 'static' }, outDir },
      fakeGenerate,
    );
    // Vendored files are excluded from the budgeted artifact file list.
    assert.ok(!artifact.files.some((f) => f.path.startsWith('vendor/')));

    for (const name of RUNTIME_VENDOR_PACKAGES) {
      const entry = join(outDir, 'vendor', name, 'index.js');
      await stat(entry); // import-map target exists on disk
    }

    // Every vendored JS file parses as an ES module.
    const vendorDir = join(outDir, 'vendor');
    const seen = [];
    for await (const file of walkJs(vendorDir)) {
      execFileSync(process.execPath, ['--check', file]);
      seen.push(file);
    }
    assert.ok(seen.length >= RUNTIME_VENDOR_PACKAGES.length, 'expected vendored JS files');

    // Every bare @lumen import inside vendored files is covered by the map.
    const covered = new Set(RUNTIME_VENDOR_PACKAGES.map((n) => `@lumen/${n}`));
    for await (const file of walkJs(vendorDir)) {
      const src = await readFile(file, 'utf8');
      for (const m of src.matchAll(/from\s+['"](@lumen\/[a-z]+)['"]/g)) {
        assert.ok(covered.has(m[1]), `${file}: uncovered bare import ${m[1]}`);
      }
    }

    // Stale-clean keeps vendored files across rebuilds.
    await build({ target: { target: 'static' }, outDir }, fakeGenerate);
    await stat(join(outDir, 'vendor', 'runtime', 'index.js'));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('non-static targets do not vendor by default; flag overrides', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'lumen-vendor-off-'));
  try {
    await build({ target: { target: 'runtime' }, outDir }, fakeGenerate);
    await assert.rejects(stat(join(outDir, 'vendor', 'runtime', 'index.js')));

    await build(
      { target: { target: 'runtime' }, outDir, vendorRuntime: true },
      fakeGenerate,
    );
    await stat(join(outDir, 'vendor', 'runtime', 'index.js'));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

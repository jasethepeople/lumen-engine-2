import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { CodegenResult } from '@lumen/contracts';

import { build, buildAll } from '../src/build.js';
import { hashPlannedFiles } from '../src/pipeline.js';

function fakeGenerate(): CodegenResult {
  return {
    entry: 'entry.js',
    files: [
      {
        path: 'entry.js',
        source: `import { chunk } from './chunk.js';\nconsole.log(chunk);\n`,
        imports: ['./chunk.js'],
      },
      { path: 'chunk.js', source: 'export const chunk = 42;\n', imports: [] },
      { path: 'assets/hero.webp', source: 'fake-binary-bytes', imports: [] },
    ],
    hydrationManifest: { islands: [] },
    typeDeclarations: 'export declare const chunk: number;\n',
    ssrHtml: '<!doctype html><html><body><div id="app"></div><script type="module" src="./entry.js"></script></body></html>',
    importGraph: ['./chunk.js'],
    warnings: [{ code: 'unused-asset', message: 'poster.png is never referenced', subject: 'poster.png' }],
  };
}

async function tmpOut(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'lumen-build-'));
}

test('hashPlannedFiles renames hashed files and rewrites specifiers', () => {
  const { files, renames } = hashPlannedFiles([
    {
      path: 'entry.js',
      content: `import './chunk.js';`,
      role: 'entry',
      hashed: true,
    },
    { path: 'chunk.js', content: 'export {};', role: 'chunk', hashed: true },
  ]);
  const chunkRename = renames.get('chunk.js');
  const entryRename = renames.get('entry.js');
  assert.ok(chunkRename && /^chunk\.[0-9a-f]{10}\.js$/.test(chunkRename));
  assert.ok(entryRename && /^entry\.[0-9a-f]{10}\.js$/.test(entryRename));
  const entry = files.find((f) => f.path === entryRename);
  assert.ok(entry?.content.includes(`'./${chunkRename}'`));
});

test('full pipeline: static target emits hashed files, html, manifest, cleans stale', async () => {
  const outDir = await tmpOut();
  try {
    // Stale file from a "previous build" should be removed.
    await writeFile(join(outDir, 'stale-old-file.js'), 'old');

    const artifact = await build(
      { target: { target: 'static' }, outDir, environment: 'test' },
      fakeGenerate,
    );

    assert.equal(artifact.target, 'static');
    assert.equal(artifact.entry, 'index.html');
    assert.ok(artifact.files.length >= 3);

    const entryJs = artifact.files.find((f) => f.role === 'entry');
    assert.ok(entryJs && /^entry\.[0-9a-f]{10}\.js$/.test(entryJs.path));
    assert.ok(entryJs.gzipBytes > 0 && entryJs.bytes > 0);

    // import specifier inside entry.js was rewritten to the hashed chunk name.
    const entrySource = await readFile(join(outDir, entryJs.path), 'utf8');
    const chunk = artifact.files.find((f) => f.path.startsWith('chunk.'));
    assert.ok(chunk);
    assert.match(entrySource, new RegExp(`'\\./${chunk.path.replace('.', '\\.')}'`));

    // SSR html emitted unhashed, and its script src rewritten.
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`src="\\./${entryJs.path.replace(/\./g, '\\.')}"`));

    // manifest.json lists files; stale file removed.
    const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.target, 'static');
    assert.equal(manifest.entry, 'index.html');
    const names = await readdir(outDir);
    assert.ok(!names.includes('stale-old-file.js'));

    // budgets evaluated with defaults; report payload present.
    assert.equal(typeof artifact.budgets.passed, 'boolean');
    assert.ok(artifact.budgets.checks.length > 0);
    assert.equal(artifact.report.target, 'static');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('minify hooks are applied when target.minify is not false', async () => {
  const outDir = await tmpOut();
  try {
    const artifact = await build(
      {
        target: { target: 'webcomponent', minify: true },
        outDir,
        minifyHooks: [(content, path) => (path.endsWith('.js') ? content.replace(/\n/g, '') : content)],
      },
      fakeGenerate,
    );
    const chunk = artifact.files.find((f) => f.path.startsWith('chunk.'));
    assert.ok(chunk);
    const source = await readFile(join(outDir, chunk.path), 'utf8');
    assert.ok(!source.includes('\n'));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('strictBudgets throws when a budget fails', async () => {
  const outDir = await tmpOut();
  try {
    await assert.rejects(
      build(
        {
          target: { target: 'npm' },
          outDir,
          strictBudgets: true,
          budgets: [{ metric: 'js-gz', budget: 1 }],
        },
        fakeGenerate,
      ),
      /size budgets failed/,
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('npm target emits unhashed files and a .d.ts', async () => {
  const outDir = await tmpOut();
  try {
    const artifact = await build({ target: { target: 'npm' }, outDir }, fakeGenerate);
    assert.equal(artifact.entry, 'entry.js');
    const dts = artifact.files.find((f) => f.path === 'entry.d.ts');
    assert.ok(dts);
    const dtsSource = await readFile(join(outDir, 'entry.d.ts'), 'utf8');
    assert.match(dtsSource, /declare const chunk/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('buildAll emits one artifact per target into per-target subdirs', async () => {
  const outDir = await tmpOut();
  try {
    const artifacts = await buildAll(
      {
        targets: [{ target: 'static' }, { target: 'runtime' }],
        outDir,
      },
      fakeGenerate,
    );
    assert.equal(artifacts.length, 2);
    assert.equal(artifacts[0].outDir, join(outDir, 'static'));
    assert.equal(artifacts[1].outDir, join(outDir, 'runtime'));
    assert.ok((await readdir(outDir)).sort().join(',') === 'runtime,static');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('build rejects an unknown target', async () => {
  const outDir = await tmpOut();
  try {
    await assert.rejects(
      // @ts-expect-error intentionally invalid target
      build({ target: { target: 'nope' }, outDir }, fakeGenerate),
      /unknown target/,
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

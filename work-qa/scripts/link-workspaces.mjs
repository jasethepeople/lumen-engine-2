#!/usr/bin/env node
/**
 * Create node_modules/@lumen/<name> shims so the compiled workspace output is
 * importable under plain Node (`import '@lumen/kernel'` etc.).
 *
 * The engine mount does not support symlinks, so `npm install` / workspace
 * linking fails. Instead we create one real directory per package containing:
 *   - package.json  (type: module, main/exports -> ./index.js)
 *   - index.js      (`export * from '<relative path to compiled dist>';`)
 *   - index.d.ts    (same, for type resolution)
 *
 * Importing packages' own package.json "exports" still point at their dist
 * layouts; the shim layout table below mirrors them.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Uniform build convention: every package compiles `src/` to a flat
 * `<dir>/dist/index.js` (rootDir: "src"), so the entry table is a simple loop.
 */
const PACKAGE_DIRS = [
  'contracts',
  ...[
    'kernel', 'scene', 'rendering', 'assets', 'interaction',
    'templates', 'config', 'codegen', 'build', 'runtime',
  ].map((name) => `packages/${name}`),
];
const ENTRIES = Object.fromEntries(
  PACKAGE_DIRS.map((dir) => [dir.split('/').pop(), `${dir}/dist/index.js`]),
);

const scopeDir = join(root, 'node_modules', '@lumen');
mkdirSync(scopeDir, { recursive: true });

let linked = 0;
for (const [name, entry] of Object.entries(ENTRIES)) {
  const absEntry = join(root, entry);
  if (!existsSync(absEntry)) {
    console.warn(`warn: ${name}: ${entry} missing (build it first) — skipped`);
    continue;
  }
  const dir = join(scopeDir, name);
  mkdirSync(dir, { recursive: true });
  const relJs = relative(dir, absEntry).split('\\').join('/');
  const relDts = relJs.replace(/\.js$/, '.d.ts');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: `@lumen/${name}`,
        version: '0.1.0',
        type: 'module',
        main: './index.js',
        types: './index.d.ts',
        exports: { '.': { types: './index.d.ts', default: './index.js' } },
      },
      null,
      2 ) + '\n',
  );
  writeFileSync(join(dir, 'index.js'), `export * from '${relJs}';\n`);
  writeFileSync(join(dir, 'index.d.ts'), `export * from '${relDts}';\n`);
  linked++;
}
console.log(`link-workspaces: ${linked} @lumen shims ready`);

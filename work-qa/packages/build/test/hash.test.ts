import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contentHash, hashedFilename, rewriteImportPaths } from '../src/hash.js';

test('contentHash is deterministic', () => {
  const a = contentHash('hello lumen');
  const b = contentHash('hello lumen');
  assert.equal(a, b);
  assert.equal(a.length, 10);
  assert.match(a, /^[0-9a-f]+$/);
});

test('contentHash differs for different content', () => {
  assert.notEqual(contentHash('a'), contentHash('b'));
});

test('contentHash accepts Uint8Array', () => {
  const bytes = new TextEncoder().encode('hello lumen');
  assert.equal(contentHash(bytes), contentHash('hello lumen'));
});

test('contentHash validates length', () => {
  assert.throws(() => contentHash('x', 2), RangeError);
  assert.throws(() => contentHash('x', 65), RangeError);
});

test('hashedFilename inserts hash before extension', () => {
  assert.equal(hashedFilename('runtime/entry.js', 'abc123'), 'runtime/entry.abc123.js');
  assert.equal(hashedFilename('style.css', 'fff'), 'style.fff.css');
  assert.equal(hashedFilename('LICENSE', 'abc'), 'LICENSE.abc');
  assert.equal(hashedFilename('a/b/c.mjs', '1234'), 'a/b/c.1234.mjs');
});

test('rewriteImportPaths rewrites quoted specifiers only', () => {
  const src = [
    `import { boot } from './runtime/entry.js';`,
    `const name = "./runtime/entry.js";`,
    'const bare = ./runtime/entry.js;', // unquoted — must not be touched
    "const other = './other.js';",
  ].join('\n');
  const map = new Map([['./runtime/entry.js', './runtime/entry.aaa111.js']]);
  const { source, substitutions } = rewriteImportPaths(src, map);
  assert.equal(substitutions, 2);
  assert.match(source, /from '\.\/runtime\/entry\.aaa111\.js'/);
  assert.match(source, /const name = "\.\/runtime\/entry\.aaa111\.js"/);
  assert.match(source, /const bare = \.\/runtime\/entry\.js;/);
  assert.match(source, /const other = '\.\/other\.js';/);
});

test('rewriteImportPaths applies longest keys first', () => {
  const src = `import './a/b.js'; import './a/b';`;
  const map = new Map([
    ['./a/b', './a/b.H1'],
    ['./a/b.js', './a/b.H2.js'],
  ]);
  const { source, substitutions } = rewriteImportPaths(src, map);
  assert.equal(substitutions, 2);
  assert.match(source, /'\.\/a\/b\.H2\.js'/);
  assert.match(source, /'\.\/a\/b\.H1'/);
});

test('rewriteImportPaths with empty map is identity', () => {
  const { source, substitutions } = rewriteImportPaths('anything', new Map());
  assert.equal(source, 'anything');
  assert.equal(substitutions, 0);
});

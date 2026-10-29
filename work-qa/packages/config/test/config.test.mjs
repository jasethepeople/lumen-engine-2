/**
 * @lumen/config — unit tests (node --test) against compiled output.
 * Run: npm run build && node --test test/
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFIG_VERSION,
  applyDefaults,
  deepMerge,
  migrate,
  parseConfig,
  stripJsonComments,
  validateConfig,
} from '../dist/index.js';

/** Minimal valid v3 config used across tests. */
function validConfig() {
  return {
    version: 3,
    id: 'demo-site',
    template: 'scroll-video',
    meta: { title: 'Demo', description: 'A demo site', locale: 'en-US' },
    theme: { colors: { 'color-accent': '#ff0055' } },
    assets: [
      { id: 'hero-video', src: './media/hero.mp4', kind: 'video', profile: 'scrub' },
      { id: 'poster', src: './media/poster.jpg', kind: 'image', preload: 'critical' },
    ],
    scenes: [
      {
        id: 'intro',
        slot: 'hero',
        nodes: [
          { id: 'vp', kind: 'video-plane', assetId: 'hero-video' },
          { id: 'caption', kind: 'dom', html: '<h1>Hello</h1>' },
        ],
        track: { driver: 'scroll', durationOrRange: 1200 },
        a11y: { label: 'Intro section', summary: 'Opening video' },
      },
    ],
    interactions: [
      { id: 'scroll-intro', source: 'scroll', scene: 'intro', inputRange: [0, 1200], a11yFallback: 'steps' },
    ],
    build: { target: 'static' },
  };
}

test('valid config passes validation and gains defaults', () => {
  const r = parseConfig(validConfig());
  assert.equal(r.ok, true);
  assert.equal(r.appliedMigrations.length, 0);
  assert.equal(r.config.version, CONFIG_VERSION);
  // build defaults
  assert.equal(r.config.build.target, 'static');
  assert.equal(r.config.build.minify, true);
  assert.equal(r.config.build.ssr, true);
  assert.equal(r.config.build.moduleFormat, 'esm');
  // preload heuristic: video → eager, explicit critical preserved
  assert.equal(r.config.assets[0].preload, 'eager');
  assert.equal(r.config.assets[1].preload, 'critical');
  // theme defaults merged under authored overrides
  assert.equal(r.config.theme.colors['color-accent'], '#ff0055');
  assert.equal(r.config.theme.colors['color-bg'], '#0b0d10');
  assert.equal(r.config.theme.motion.duration.fast, 150);
});

test('JSONC string input is accepted (comments stripped)', () => {
  const src = `{
    // engine id
    "version": 3,
    "id": "jsonc-site", /* block comment */
    "template": "storytelling",
    "meta": { "title": "T", "description": "D", "locale": "en" },
    "theme": {},
    "assets": [],
    "scenes": [],
    "interactions": [],
    "build": { "target": "runtime" }
  }`;
  const r = parseConfig(src);
  assert.equal(r.ok, true);
  assert.equal(r.config.id, 'jsonc-site');
});

test('stripJsonComments preserves strings containing comment markers', () => {
  const stripped = stripJsonComments('{"url": "https://a/b" } // trailing');
  assert.deepEqual(JSON.parse(stripped), { url: 'https://a/b' });
});

test('invalid config reports precise JSON paths', () => {
  const bad = validConfig();
  bad.template = 'nope';
  bad.meta.title = '';
  bad.scenes[0].track.driver = 'warp';
  bad.build.moduleFormat = 'amd';
  bad.extra = true;
  const r = parseConfig(bad);
  assert.equal(r.ok, false);
  const paths = r.errors.map((e) => e.path);
  for (const expected of [
    'template',
    'meta.title',
    'scenes[0].track.driver',
    'build.moduleFormat',
    'extra',
  ]) {
    assert.ok(paths.includes(expected), `expected error at ${expected}, got: ${paths.join(', ')}`);
  }
});

test('dangling cross-references are reported (schema-valid config)', () => {
  const bad = validConfig();
  bad.scenes[0].nodes[0].assetId = 'missing-asset';
  bad.interactions[0].scene = 'ghost';
  const r = parseConfig(bad);
  assert.equal(r.ok, false);
  const paths = r.errors.map((e) => e.path);
  assert.ok(paths.includes('scenes[0].nodes[0].assetId'), `got: ${paths.join(', ')}`);
  assert.ok(paths.includes('interactions[0].scene'), `got: ${paths.join(', ')}`);
});

test('missing required fields and wrong types are reported', () => {
  const r = validateConfig({ version: 3, id: 'x', template: 'viewer-3d', meta: { title: 'T' } });
  assert.equal(r.ok, false);
  const paths = r.errors.map((e) => e.path);
  assert.ok(paths.includes('meta.description'));
  assert.ok(paths.includes('meta.locale'));
  assert.ok(paths.includes('theme'));
  assert.ok(paths.includes('assets'));
  assert.ok(paths.includes('scenes'));
  assert.ok(paths.includes('interactions'));
  assert.ok(paths.includes('build'));
});

test('duplicate ids are rejected', () => {
  const cfg = validConfig();
  cfg.assets.push({ ...cfg.assets[0] });
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === 'assets[2].id' && e.message.includes('duplicate')));
});

test('node kind invariants enforced (video-plane requires assetId, dom requires html)', () => {
  const cfg = validConfig();
  cfg.scenes[0].nodes = [
    { id: 'vp', kind: 'video-plane' },
    { id: 'd', kind: 'dom' },
  ];
  const r = validateConfig(cfg);
  assert.equal(r.ok, false);
  const paths = r.errors.map((e) => e.path);
  assert.ok(paths.includes('scenes[0].nodes[0].assetId'));
  assert.ok(paths.includes('scenes[0].nodes[1].html'));
});

test('v0 legacy config migrates to current version', () => {
  const legacy = {
    // no version → treated as v0
    site: 'legacy-site',
    template: 'cinematic-spa',
    meta: { title: 'Legacy', description: 'Old config', locale: 'en' },
    theme: {},
    scenes: [
      {
        id: 's1',
        slot: 'main',
        nodes: [],
        timeline: { mode: 'time', length: 8 },
        a11y: { label: 'Scene 1' },
      },
    ],
    output: { target: 'static-site', minify: false },
  };
  const r = parseConfig(JSON.stringify(legacy));
  assert.equal(r.ok, true);
  assert.deepEqual(r.appliedMigrations, ['0→1', '1→2', '2→3']);
  assert.equal(r.config.version, 3);
  assert.equal(r.config.id, 'legacy-site');
  assert.deepEqual(r.config.interactions, []);
  assert.deepEqual(r.config.scenes[0].track, { driver: 'time', durationOrRange: 8 });
  assert.equal(r.config.build.target, 'static');
  assert.equal(r.config.build.minify, false);
});

test('migrate reports applied steps and rejects newer versions', () => {
  const m = migrate({ version: 2, id: 'x', output: { target: 'npm-lib' } });
  assert.deepEqual(m.appliedMigrations, ['2→3']);
  assert.equal(m.config.version, 3);
  assert.equal(m.config.build.target, 'npm');
  assert.throws(() => migrate({ version: 99 }), /newer than supported/);
  assert.throws(() => migrate('nope'), /expected object/);
});

test('wrong or too-new version is reported by the migration stage', () => {
  const bad = validConfig();
  bad.version = 99;
  const r = parseConfig(bad);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, '');
  assert.match(r.errors[0].message, /newer than supported/);
  // version 2 triggers migration, then validation of the upgraded shape
  const v2 = validConfig();
  v2.version = 2;
  v2.build = { target: 'static' };
  const r2 = parseConfig(v2);
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.appliedMigrations, ['2→3']);
});

test('invalid JSON string reports a root error', () => {
  const r = parseConfig('{ not json');
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, '');
  assert.match(r.errors[0].message, /invalid JSON/);
});

test('deepMerge replaces arrays and merges nested objects', () => {
  const merged = deepMerge(
    { a: { b: 1, c: [1, 2] }, d: 1 },
    { a: { c: [3] }, e: 2 },
  );
  assert.deepEqual(merged, { a: { b: 1, c: [3] }, d: 1, e: 2 });
});

test('applyDefaults does not mutate its input', () => {
  const cfg = validConfig();
  const v = validateConfig(cfg);
  assert.equal(v.ok, true);
  const snapshot = JSON.stringify(v.config);
  applyDefaults(v.config);
  assert.equal(JSON.stringify(v.config), snapshot);
});

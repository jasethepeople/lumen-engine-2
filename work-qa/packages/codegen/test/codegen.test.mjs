/**
 * @lumen/codegen — unit tests (node --test) against compiled output.
 * Run: npm run build && node --test test/
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CodeWriter,
  ImportManager,
  SCENE_IR_VERSION,
  SourceFileBuilder,
  escapeString,
  generate,
  inlineJson,
  isIdentifier,
  lowerToIR,
  safeIdentifier,
} from '../dist/index.js';
import { makeConfig, makeDescriptor, makeOptions, makeScene, makeThemeTokens } from './fixtures.mjs';
import { resolveThemeTokens } from '@lumen/templates';

// ---------- emit toolkit ----------

test('CodeWriter manages indentation and blocks', () => {
  const w = new CodeWriter();
  w.line('const x = 1;');
  w.block('function f()', (bw) => bw.line('return 1;'));
  const out = w.toString();
  assert.equal(out, 'const x = 1;\nfunction f() {\n  return 1;\n}\n');
});

test('ImportManager dedupes, sorts and renders', () => {
  const im = new ImportManager();
  im.add('b-pkg', 'zeta', 'alpha').add('b-pkg', 'alpha').add('a-pkg', 'mid');
  im.addDefault('c-pkg', 'C').addSideEffect('d-pkg');
  assert.deepEqual(im.specifiers(), ['a-pkg', 'b-pkg', 'c-pkg', 'd-pkg']);
  const rendered = im.render();
  assert.match(rendered, /import \{ mid \} from 'a-pkg';/);
  assert.match(rendered, /import \{ alpha, zeta \} from 'b-pkg';/);
  assert.match(rendered, /import C from 'c-pkg';/);
  assert.match(rendered, /import 'd-pkg';/);
  assert.ok(rendered.indexOf('a-pkg') < rendered.indexOf('b-pkg'));
});

test('ImportManager rejects conflicting default imports', () => {
  const im = new ImportManager();
  im.addDefault('pkg', 'A');
  assert.throws(() => im.addDefault('pkg', 'B'));
});

test('identifier helpers escape unsafe names', () => {
  assert.equal(isIdentifier('foo'), true);
  assert.equal(isIdentifier('class'), false);
  assert.equal(isIdentifier('0abc'), false);
  assert.equal(safeIdentifier('class'), 'class_');
  assert.equal(safeIdentifier('0abc'), '_0abc');
  assert.equal(safeIdentifier('my site!'), 'my_site_');
  assert.equal(safeIdentifier(''), '_');
});

test('escapeString and inlineJson neutralize HTML/JS breakouts', () => {
  assert.equal(escapeString("a'b</script>"), "a\\'b\\x3c/script\\x3e");
  const json = inlineJson({ x: '</script><script>', y: 'a&b' });
  assert.ok(!json.includes('</script>'));
  assert.ok(json.includes('\\u003c'));
  assert.ok(json.includes('\\u0026'));
  // Still valid JSON after unescaping (JSON.parse tolerates unicode escapes).
  assert.deepEqual(JSON.parse(json), { x: '</script><script>', y: 'a&b' });
});

test('SourceFileBuilder produces path/source/imports', () => {
  const b = new SourceFileBuilder('main.ts');
  b.imports.add('@lumen/runtime', 'bootEngine');
  b.writer.line('bootEngine();');
  const mod = b.build();
  assert.equal(mod.path, 'main.ts');
  assert.deepEqual(mod.imports, ['@lumen/runtime']);
  assert.match(mod.source, /import \{ bootEngine \} from '@lumen\/runtime';\n\nbootEngine\(\);\n/);
});

// ---------- IR lowering ----------

test('lowerToIR lowers config + scene into a serializable SceneIR', () => {
  const config = makeConfig();
  const ir = lowerToIR(config, makeThemeTokens(), makeScene());
  assert.equal(ir.version, SCENE_IR_VERSION);
  assert.equal(ir.template, 'scroll-video');
  assert.equal(ir.site.title, 'Demo "Site" <tag>');
  assert.equal(ir.nodes.length, 1);
  const root = ir.nodes[0];
  assert.equal(root.children.length, 3);
  const dom = root.children.find((n) => n.id === 'n-copy');
  assert.equal(dom.html, '<h1>Hello</h1>');
  assert.equal(dom.bindings[0].trackId, 't-scroll');
  const vid = root.children.find((n) => n.id === 'n-vid');
  assert.equal(vid.assetId, 'hero-video');
  assert.equal(vid.scrubbed, true);
  assert.equal(ir.tracks[0].driver, 'scroll');
  assert.equal(ir.bindings[0].targetTrackId, 't-scroll');
  assert.equal(ir.assets.length, 2);
  assert.equal(ir.a11y.hero.label, 'Hero scene');
  // Theme merge: override wins, defaults preserved.
  assert.equal(ir.theme.colors['color-accent'], '#ff0055');
  assert.equal(ir.theme.colors['color-bg'], '#000000');
  // Round-trips through JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(ir)), ir);
});

// Theme merging now lives in @lumen/templates (resolveThemeTokens); codegen's
// lowerToIR delegates to it. Verify the same semantics through the new home.
test('resolveThemeTokens merges nested motion durations', () => {
  const merged = resolveThemeTokens(makeThemeTokens(), {
    motion: { duration: { fast: 100 } },
  });
  assert.equal(merged.motion.duration.fast, 100);
  assert.equal(merged.motion.duration.slow, 600);
  assert.deepEqual(merged.motion.standard, [0.4, 0, 0.2, 1]);
});

// ---------- per-target generation ----------

const IMPORT_RE = /^import(?:\s+[\w*$ {},]+?\s+from)?\s+'[^']+';$/;

function assertValidImports(mod) {
  for (const line of mod.source.split('\n')) {
    if (line.startsWith('import')) {
      assert.match(line, IMPORT_RE, `malformed import: ${line}`);
    }
  }
  for (const spec of mod.imports) {
    assert.ok(mod.source.includes(`'${spec}'`), `imports lists '${spec}' but source lacks it`);
  }
}

test("target 'static' emits index.html + main module with SEO meta and SSR shell", () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('static'));
  assert.equal(res.entry, 'main.ts');
  const paths = res.files.map((f) => f.path);
  assert.deepEqual(paths.sort(), ['hydration-manifest.json', 'index.html', 'main.ts']);
  const main = res.files.find((f) => f.path === 'main.ts');
  assertValidImports(main);
  assert.deepEqual(main.imports, ['@lumen/runtime']);
  assert.ok(main.source.includes('SCENE_IR'));
  const html = res.files.find((f) => f.path === 'index.html');
  assert.match(html.source, /<title>Demo &quot;Site&quot; &lt;tag&gt;<\/title>/);
  assert.match(html.source, /<meta name="description"/);
  assert.match(html.source, /property="og:image" content="https:\/\/example\.com\/og\.png"/);
  // C3: SSR CSS variables use the templates `--lumen-*` convention.
  assert.match(html.source, /--lumen-color-color-accent: #ff0055/);
  assert.match(html.source, /<noscript>/);
  // SSR skeleton: dom node html inlined, video plane placeholder present.
  assert.match(html.source, /<h1>Hello<\/h1>/);
  assert.match(html.source, /data-asset="hero-video"/);
  // Inline IR JSON must not contain a raw closing script tag.
  assert.ok(!html.source.includes('</script><script>'));
  assert.equal(res.ssrHtml, html.source);
  assert.deepEqual(res.hydrationManifest.islands, [
    { id: 'hero', module: 'main.ts', trigger: 'eager', props: { sceneId: 'hero' } },
  ]);
  const manifest = res.files.find((f) => f.path === 'hydration-manifest.json');
  assert.deepEqual(JSON.parse(manifest.source), res.hydrationManifest);
});

test("target 'static' collects warnings (missing asset, unused critical, a11y gaps)", () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('static'));
  const codes = res.warnings.map((w) => w.code);
  assert.ok(codes.includes('missing-asset'), 'ghost-asset flagged');
  assert.ok(codes.includes('unused-asset'), 'unused-img flagged');
  assert.ok(codes.includes('a11y-missing-summary'));
  assert.ok(codes.includes('a11y-missing-fallback'));
  const missing = res.warnings.find((w) => w.code === 'missing-asset');
  assert.equal(missing.subject, 'ghost-asset');
});

test("target 'static' emits JS when emitTypeScript is false", () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), {
    target: { target: 'static' },
    emitTypeScript: false,
  });
  assert.equal(res.entry, 'main.js');
  const main = res.files.find((f) => f.path === 'main.js');
  assert.ok(!main.source.includes(': Promise<void>'), 'no TS annotations in JS output');
});

test("target 'webcomponent' emits a self-contained <lumen-embed> element", () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('webcomponent'));
  assert.equal(res.entry, 'lumen-embed.ts');
  const mod = res.files[0];
  assertValidImports(mod);
  assert.match(mod.source, /class LumenEmbed extends HTMLElement/);
  assert.match(mod.source, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(mod.source, /customElements\.define\('lumen-embed', LumenEmbed\)/);
  assert.match(mod.source, /getAttribute\('config-url'\)/);
  assert.equal(res.ssrHtml, '');
});

test("target 'runtime' emits a fetch-based loader with no embedded IR", () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('runtime'));
  assert.equal(res.entry, 'loader.ts');
  const mod = res.files[0];
  assertValidImports(mod);
  assert.match(mod.source, /export async function loadLumen\(configUrl: string/);
  assert.match(mod.source, /await fetch\(configUrl/);
  assert.ok(!mod.source.includes('SCENE_IR'), 'loader must not embed the IR');
  assert.deepEqual(res.hydrationManifest.islands, []);
});

test("target 'npm' emits a package entry re-exporting a preconfigured factory", () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('npm'));
  assert.equal(res.entry, 'index.ts');
  const mod = res.files[0];
  assertValidImports(mod);
  assert.match(mod.source, /export async function create_demo_site_engine\(root: HTMLElement\)/);
  assert.match(mod.source, /export const sceneIR = SCENE_IR;/);
  assert.match(mod.source, /export \{ bootEngine, hydrateIslands \} from '@lumen\/runtime';/);
});

test('result carries import graph, type declarations and no unescaped identifiers', () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('npm'));
  assert.deepEqual(res.importGraph, ['@lumen/runtime']);
  assert.match(res.typeDeclarations, /declare module 'index'/);
  const mod = res.files[0];
  // The dashed site id only appears inside the JSON payload, never as an identifier.
  assert.ok(!mod.source.includes('create_demo-site'), 'dashed id must be escaped into identifier');
  assert.ok(mod.source.includes('create_demo_site_engine'));
});

test('minify strips comments and blank lines for entry modules', () => {
  const res = generate(makeConfig(), makeDescriptor(), makeScene(), {
    target: { target: 'npm', minify: true },
  });
  const mod = res.files[0];
  assert.ok(!mod.source.startsWith('//'));
  assert.ok(!mod.source.includes('\n\n'));
});

test('emitted JS modules parse (node --check)', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'lumen-codegen-'));
  for (const target of ['static', 'webcomponent', 'runtime', 'npm']) {
    const res = generate(makeConfig(), makeDescriptor(), makeScene(), {
      target: { target },
      emitTypeScript: false,
    });
    for (const f of res.files) {
      if (!f.path.endsWith('.js')) continue;
      const p = join(dir, `${target}-${f.path}.mjs`);
      writeFileSync(p, f.source);
      execFileSync(process.execPath, ['--check', p]); // throws on syntax error
    }
  }
});

test('unknown target throws', () => {
  assert.throws(() =>
    generate(makeConfig(), makeDescriptor(), makeScene(), makeOptions('bogus')),
  );
});

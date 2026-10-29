/**
 * @lumen/app-ai — headless tests.
 *
 * Covers: generation validity across prompts (parseConfig gate on every
 * output + re-parse of the returned config), determinism of the heuristic
 * provider and generator, MockAIProvider scripting, typed AIGenerationError
 * on empty input, motion/chapter/camera suggestion shapes against contract
 * conventions, asset tagging incl. magic-byte sniffing and colorway
 * grouping, and template recommendation ranking (array + catalog forms).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '@lumen/config';
import { BUILTIN_TEMPLATES, TemplateCatalog } from '@lumen/app-marketplace';
import {
  AIGenerationError,
  HeuristicProvider,
  MockAIProvider,
  detectColorwayVariants,
  generateSceneIRFromDescription,
  inferTemplateKind,
  recommendTemplates,
  suggestCameraTracks,
  suggestChapterStructure,
  suggestMotionProfiles,
  tagAsset,
} from '@lumen/app-ai';

const PROMPTS = [
  'A calm, minimal portfolio for a landscape photographer with 4 chapters about mountains, oceans, deserts and forests',
  'Bold energetic product launch page with video hero and three sections',
  'An elegant luxury watch brand story told in five chapters',
  'Scrollytelling article about deep sea exploration, serene and quiet',
  'A 3d product viewer for a sneaker with hotspot chapters',
  'Cinematic spa showcase with gallery of work',
];

test('generation: every prompt produces a config that passes parseConfig', async () => {
  for (const prompt of PROMPTS) {
    const config = await generateSceneIRFromDescription(prompt);
    const result = parseConfig(config);
    assert.ok(result.ok, `parseConfig failed for "${prompt}": ${JSON.stringify(result.ok ? null : result.errors)}`);
    assert.equal(config.version, 3);
    assert.ok(config.scenes.length >= 1 && config.scenes.length <= 12);
  }
});

test('generation: JSON round-trip of the returned config still validates', async () => {
  const config = await generateSceneIRFromDescription(PROMPTS[0]);
  const reparsed = parseConfig(JSON.stringify(config));
  assert.ok(reparsed.ok);
});

test('generation: respects mentioned chapter counts (digits and words)', async () => {
  const five = await generateSceneIRFromDescription('An elegant story in five chapters about tea');
  assert.equal(five.scenes.length, 5);
  const two = await generateSceneIRFromDescription('A bold site with 2 sections about motorsport');
  assert.equal(two.scenes.length, 2);
});

test('generation: template inference + explicit override', async () => {
  assert.equal(inferTemplateKind('a video-heavy landing'), 'scroll-video');
  assert.equal(inferTemplateKind('a 3d model viewer'), 'viewer-3d');
  const forced = await generateSceneIRFromDescription('plain text story', { templateKind: 'viewer-3d' });
  assert.equal(forced.template, 'viewer-3d');
  // viewer-3d hero references a model asset; cross-refs must validate.
  assert.ok(forced.assets.some((a) => a.kind === 'model'));
  assert.ok(parseConfig(forced).ok);
});

test('generation: scroll-video blueprint emits a video asset + validates', async () => {
  const cfg = await generateSceneIRFromDescription('cinematic video landing for a surf film');
  assert.equal(cfg.template, 'scroll-video');
  assert.ok(cfg.assets.some((a) => a.kind === 'video' && a.preload === 'critical'));
  assert.ok(cfg.scenes[0].nodes.some((n) => n.kind === 'video-plane'));
  assert.ok(parseConfig(cfg).ok);
});

test('generation: deterministic — identical inputs produce identical configs', async () => {
  const a = await generateSceneIRFromDescription(PROMPTS[1]);
  const b = await generateSceneIRFromDescription(PROMPTS[1]);
  assert.deepEqual(a, b);
});

test('generation: empty description throws typed AIGenerationError', async () => {
  await assert.rejects(
    () => generateSceneIRFromDescription('   '),
    (err) => err instanceof AIGenerationError && err.code === 'empty-description',
  );
});

test('generation: failing provider throws typed AIGenerationError', async () => {
  const broken = { name: 'broken', complete: () => Promise.reject(new Error('boom')) };
  await assert.rejects(
    () => generateSceneIRFromDescription('a calm site', { provider: broken }),
    (err) => err instanceof AIGenerationError && err.code === 'provider-failed',
  );
});

test('providers: heuristic provider is deterministic and local', async () => {
  const p = new HeuristicProvider();
  const a = await p.complete('A calm minimal site about mountains and oceans');
  const b = await p.complete('A calm minimal site about mountains and oceans');
  assert.equal(a, b);
  const parsed = JSON.parse(a);
  assert.ok(parsed.summary.length > 0);
  assert.ok(parsed.keywords.includes('mountains'));
});

test('providers: MockAIProvider scripts (string, array cycle, record match)', async () => {
  assert.equal(await new MockAIProvider('fixed').complete('anything'), 'fixed');
  const cycler = new MockAIProvider(['one', 'two']);
  assert.equal(await cycler.complete('x'), 'one');
  assert.equal(await cycler.complete('x'), 'two');
  assert.equal(await cycler.complete('x'), 'one');
  const table = new MockAIProvider({ calm: 'serene-output', video: 'video-output' }, 'fallback');
  assert.equal(await table.complete('a calm site'), 'serene-output');
  assert.equal(await table.complete('unrelated'), 'fallback');
});

test('motion: video hero -> continuous + smoothing; dom chapter -> reveal + segments', async () => {
  const config = await generateSceneIRFromDescription('video hero landing with 2 chapters about surfing');
  const suggestions = suggestMotionProfiles(config);
  assert.equal(suggestions.length, config.scenes.length);
  for (const s of suggestions) {
    assert.ok(['continuous', 'reveal', 'static'].includes(s.suggested.motion));
    assert.ok(typeof s.rationale === 'string' && s.rationale.length > 0);
    if (s.suggested.smoothing) {
      assert.ok(['lerp', 'spring', 'none'].includes(s.suggested.smoothing.mode));
    }
    if (s.suggested.segments) {
      for (const seg of s.suggested.segments) {
        assert.ok(seg.id && seg.from < seg.to && seg.keys.length >= 2);
        for (const k of seg.keys) assert.ok(typeof k.t === 'number' && k.value !== undefined);
      }
    }
  }
  const hero = suggestions.find((s) => s.sceneId === 'hero');
  assert.equal(hero.suggested.motion, 'continuous');
  assert.ok(hero.suggested.smoothing);
  const chapter = suggestions.find((s) => s.sceneId !== 'hero');
  assert.equal(chapter.suggested.motion, 'reveal');
  assert.ok(chapter.suggested.segments.length >= 1);
});

test('chapters: from description respects 1-12 bounds and count hints', () => {
  const chapters = suggestChapterStructure('A story in twenty chapters about everything');
  assert.ok(chapters.length <= 12 && chapters.length >= 1);
  const three = suggestChapterStructure('three sections on coffee brewing');
  assert.equal(three.length, 3);
  assert.equal(three[0].id, 'hero');
  for (const c of three) {
    assert.ok(c.id && c.title && c.estimatedDuration > 0 && c.rationale);
  }
  const ids = new Set(three.map((c) => c.id));
  assert.equal(ids.size, three.length);
});

test('chapters: from existing config derives one chapter per scene', async () => {
  const config = await generateSceneIRFromDescription('calm site with 3 chapters about tea');
  const chapters = suggestChapterStructure(config);
  assert.equal(chapters.length, config.scenes.length);
  assert.ok(chapters.length >= 1 && chapters.length <= 12);
});

test('chapters: empty description throws typed error', () => {
  assert.throws(() => suggestChapterStructure('  '), (err) => err instanceof AIGenerationError);
});

test('camera: keyframe shapes match track/bezier conventions', async () => {
  const config = await generateSceneIRFromDescription('3d viewer for a chair');
  const scene = config.scenes[0];
  const keys = suggestCameraTracks(scene, 'orbit');
  assert.ok(keys.length >= 2);
  let prevT = -1;
  for (const k of keys) {
    assert.ok(typeof k.t === 'number' && k.t >= prevT);
    prevT = k.t;
    if (k.position) {
      assert.equal(k.position.length, 3);
      for (const c of k.position) assert.ok(typeof c === 'number');
    }
    if (k.zoom !== undefined) assert.ok(typeof k.zoom === 'number');
    if (k.easing) assert.ok(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'].includes(k.easing));
    if (k.easingBezier) {
      assert.equal(k.easingBezier.length, 4);
      assert.ok(k.easingBezier[0] >= 0 && k.easingBezier[2] >= 0);
    }
  }
  // All presets produce valid sequences; string + {id,duration} refs work.
  for (const move of ['push-in', 'pull-back', 'orbit', 'pan', 'settle']) {
    assert.ok(suggestCameraTracks('hero', move).length >= 2);
    assert.ok(suggestCameraTracks({ id: 'hero', duration: 4 }, move).length >= 2);
  }
});

test('tagging: extension heuristics classify video vs image', () => {
  assert.equal(tagAsset({ name: 'hero-loop.mp4' }).mediaKind, 'video');
  assert.equal(tagAsset({ name: 'photo.JPEG' }).mediaKind, 'image');
  assert.equal(tagAsset({ name: 'clip.webm' }).mediaKind, 'video');
  assert.equal(tagAsset({ name: 'unknown.xyz' }).mediaKind, 'image');
  assert.equal(tagAsset({ name: 'hero-banner.png' }).isHeroCandidate, true);
  assert.equal(tagAsset({ name: 'thumb.png' }).isHeroCandidate, false);
});

test('tagging: magic-byte sniffing wins over extension', () => {
  const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); // '....ftypisom'
  assert.equal(tagAsset({ name: 'mislabeled.png', bytes: mp4 }).mediaKind, 'video');
  const avif = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]); // '....ftypavif'
  assert.equal(tagAsset({ name: 'mislabeled.mp4', bytes: avif }).mediaKind, 'image');
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]); // RIFF....WEBP
  assert.equal(tagAsset({ name: 'x.bin', bytes: webp }).mediaKind, 'image');
  const ebml = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0]);
  assert.equal(tagAsset({ name: 'x.bin', bytes: ebml }).mediaKind, 'video');
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(tagAsset({ name: 'x.bin', bytes: png }).mediaKind, 'image');
});

test('tagging: colorway suffix detection + grouping', () => {
  assert.equal(tagAsset({ name: 'hero-dark.mp4' }).colorway, 'dark');
  assert.equal(tagAsset({ name: 'hero_light.webp' }).colorway, 'light');
  assert.equal(tagAsset({ name: 'bg-vibrant.png' }).colorway, 'vibrant');
  assert.equal(tagAsset({ name: 'bg-muted.png' }).colorway, 'muted');
  assert.equal(tagAsset({ name: 'plain.png' }).colorway, undefined);

  const groups = detectColorwayVariants([
    'hero-dark.mp4',
    'hero-light.mp4',
    'hero.mp4',
    'solo.png',
    { name: 'card-muted.webp' },
    { name: 'card-vibrant.webp' },
  ]);
  const byStem = Object.fromEntries(groups.map((g) => [g.stem, g.variants]));
  assert.deepEqual(byStem['hero'], ['hero-dark.mp4', 'hero-light.mp4', 'hero.mp4']);
  assert.deepEqual(byStem['card'], ['card-muted.webp', 'card-vibrant.webp']);
  assert.equal(byStem['solo'], undefined);
});

test('recommendations: ranks by keyword overlap deterministically', () => {
  const recs = recommendTemplates('a storytelling video scroll experience', BUILTIN_TEMPLATES);
  assert.ok(recs.length >= 1);
  for (let i = 1; i < recs.length; i++) {
    assert.ok(recs[i - 1].score >= recs[i].score);
  }
  for (const r of recs) assert.ok(r.id && r.rationale);
  // Determinism.
  const again = recommendTemplates('a storytelling video scroll experience', BUILTIN_TEMPLATES);
  assert.deepEqual(recs, again);
  // Tag-form input works too.
  const byTags = recommendTemplates({ tags: ['storytelling', 'editorial'] }, BUILTIN_TEMPLATES);
  assert.ok(byTags.length >= 1);
  // No overlap -> empty.
  assert.deepEqual(recommendTemplates('zzzqk qkzzz', BUILTIN_TEMPLATES), []);
});

test('recommendations: catalog ({search}) form is accepted and rescored', async () => {
  const catalog = await new TemplateCatalog().load();
  const recs = recommendTemplates('storytelling narrative', catalog);
  assert.ok(recs.length >= 1);
  assert.ok(BUILTIN_TEMPLATES.some((t) => t.id === recs[0].id));
});

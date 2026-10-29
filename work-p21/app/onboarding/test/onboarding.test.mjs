/**
 * @lumen/app-onboarding — headless tests.
 *
 * Covers: full happy-path walkthrough per built-in template kind,
 * per-step validation blocking (skip-ahead, bad extension, 0 / >12
 * chapters, bad theme id), back-navigation preserving answers, draft
 * serialize/resume round-trip mid-wizard, buildConfig() passing
 * parseConfig for every template kind, createProjectFromWizard()
 * integration with MemoryStorage, and checklist status derivation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '@lumen/config';
import { MemoryStorage, ProjectStore } from '@lumen/app-projects';
import { listThemePresets } from '@lumen/app-settings';
import {
  OnboardingWizard,
  PUBLISH_CHECKLIST,
  RuntimeTemplateProvider,
  STEP_IDS,
  buildConfig,
  createProjectFromWizard,
  resumeDraft,
  saveDraft,
} from '../dist/index.js';

/** Deterministic template provider with one template per built-in kind. */
const FAKE_TEMPLATES = [
  { id: 'tpl-scroll', name: 'Scroll', kind: 'scroll-video' },
  { id: 'tpl-spa', name: 'Spa', kind: 'cinematic-spa' },
  { id: 'tpl-3d', name: '3D', kind: 'viewer-3d' },
  { id: 'tpl-story', name: 'Story', kind: 'storytelling' },
];
const fakeProvider = { list: () => FAKE_TEMPLATES.map((t) => ({ ...t })) };

function makeWizard() {
  return new OnboardingWizard({ templateProvider: fakeProvider });
}

/** Drive a wizard through every step up to (excluding) first-publish. */
function walkToFirstPublish(wizard, templateId = 'tpl-scroll') {
  assert.equal(wizard.start().stepId, 'welcome');
  assert.equal(wizard.next().state.stepId, 'choose-template');
  assert.ok(wizard.next({ templateId }).ok);
  assert.ok(
    wizard.next({ heroMedia: [{ name: 'hero.mp4', kind: 'video' }] }).ok,
  );
  assert.ok(
    wizard.next({
      chapters: [
        { id: 'ch-1', title: 'Opening' },
        { id: 'ch-2', title: 'Middle', duration: 2500 },
        { id: 'ch-3', title: 'Finale' },
      ],
    }).ok,
  );
  assert.ok(wizard.next({ themeId: 'warm-stone' }).ok);
  assert.equal(wizard.state().stepId, 'preview-motion');
  assert.ok(wizard.next({ motionPref: 'reveal' }).ok);
  assert.equal(wizard.state().stepId, 'first-publish');
  return wizard;
}

// ------------------------------------------------------------- happy path --

test('happy-path walkthrough for every built-in template kind', () => {
  for (const tpl of FAKE_TEMPLATES) {
    const wizard = walkToFirstPublish(makeWizard(), tpl.id);
    wizard.markProjectSaved();
    const res = wizard.next({ publishTarget: 'lumen.hosting' });
    assert.equal(res.ok, true, `template ${tpl.kind}: ${res.errors}`);
    assert.equal(res.state.stepId, 'done');
    assert.equal(res.state.done, true);
    assert.equal(res.state.answers.templateId, tpl.id);
    assert.equal(res.state.answers.chapters.length, 3);
  }
});

test('default RuntimeTemplateProvider wraps listTemplates() from app-runtime', () => {
  const provider = new RuntimeTemplateProvider();
  const templates = provider.list();
  assert.ok(templates.length >= 3);
  for (const t of templates) {
    assert.ok(t.id && t.name && t.kind);
  }
  const kinds = new Set(templates.map((t) => t.kind));
  for (const kind of ['scroll-video', 'cinematic-spa', 'viewer-3d', 'storytelling']) {
    assert.ok(kinds.has(kind), `missing kind ${kind}`);
  }
});

test('step content carries title, plain-language tooltip, checklist, optional flag', () => {
  const wizard = makeWizard();
  assert.equal(wizard.steps().length, 8);
  assert.deepEqual([...STEP_IDS], [
    'welcome', 'choose-template', 'upload-hero-media', 'define-chapters',
    'pick-theme', 'preview-motion', 'first-publish', 'done',
  ]);
  for (const step of wizard.steps()) {
    assert.ok(step.title.length > 0, step.id);
    assert.ok(step.tooltip.length > 20 && step.tooltip.length < 400, step.id);
    assert.ok(Array.isArray(step.checklist) && step.checklist.length >= 1, step.id);
    assert.equal(typeof step.optional, 'boolean', step.id);
  }
  assert.equal(wizard.stepContent('first-publish').checklist.length, PUBLISH_CHECKLIST.length);
});

test('subscribe() notifies on every transition; unsubscribe stops it', () => {
  const wizard = makeWizard();
  const seen = [];
  const unsub = wizard.subscribe((s) => seen.push(s.stepId));
  wizard.start();
  wizard.next();
  unsub();
  wizard.next({ templateId: 'tpl-scroll' });
  assert.deepEqual(seen, ['welcome', 'choose-template']);
});

// ------------------------------------------------------ validation blocks --

test('choose-template requires a known templateId', () => {
  const wizard = makeWizard();
  wizard.start();
  wizard.next();
  let res = wizard.next();
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /templateId is required/);
  res = wizard.next({ templateId: 'nope' });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /unknown templateId/);
  assert.equal(res.state.stepId, 'choose-template');
});

test('upload-hero-media requires ≥1 asset and validates extension allowlist', () => {
  const wizard = makeWizard();
  wizard.start();
  wizard.next();
  wizard.next({ templateId: 'tpl-scroll' });
  assert.equal(wizard.next({ heroMedia: [] }).ok, false);
  assert.equal(wizard.next().ok, false);
  const bad = wizard.next({ heroMedia: [{ name: 'clip.mov', kind: 'video' }] });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /unsupported extension/);
  const badImg = wizard.next({ heroMedia: [{ name: 'photo.gif', kind: 'image' }] });
  assert.equal(badImg.ok, false);
  for (const name of ['a.mp4', 'b.webm', 'c.webp', 'd.avif', 'e.jpg', 'f.png']) {
    const kind = name.endsWith('mp4') || name.endsWith('webm') ? 'video' : 'image';
    assert.ok(wizard.next({ heroMedia: [{ name, kind }] }).ok, name);
    wizard.back();
  }
  assert.equal(wizard.state().stepId, 'upload-hero-media');
});

test('define-chapters enforces 1–12 chapters', () => {
  const wizard = makeWizard();
  wizard.start();
  wizard.next();
  wizard.next({ templateId: 'tpl-scroll' });
  wizard.next({ heroMedia: [{ name: 'hero.png', kind: 'image' }] });
  assert.equal(wizard.next({ chapters: [] }).ok, false);
  const tooMany = Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, title: `C${i}` }));
  const res = wizard.next({ chapters: tooMany });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /at most 12/);
  const twelve = tooMany.slice(0, 12);
  assert.ok(wizard.next({ chapters: twelve }).ok);
});

test('pick-theme rejects unknown preset ids', () => {
  const wizard = makeWizard();
  wizard.start();
  wizard.next();
  wizard.next({ templateId: 'tpl-scroll' });
  wizard.next({ heroMedia: [{ name: 'hero.png', kind: 'image' }] });
  wizard.next({ chapters: [{ id: 'c1', title: 'One' }] });
  const res = wizard.next({ themeId: 'neon-glow' });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /unknown theme preset/);
  for (const preset of listThemePresets()) {
    assert.ok(wizard.next({ themeId: preset.id }).ok, preset.id);
    wizard.back();
  }
});

test('preview-motion validates the motion preference', () => {
  const wizard = makeWizard();
  wizard.start();
  wizard.next();
  wizard.next({ templateId: 'tpl-scroll' });
  wizard.next({ heroMedia: [{ name: 'hero.png', kind: 'image' }] });
  wizard.next({ chapters: [{ id: 'c1', title: 'One' }] });
  wizard.next({ themeId: 'sand-dune' });
  assert.equal(wizard.next().ok, false);
  assert.equal(wizard.next({ motionPref: 'zoomy' }).ok, false);
  for (const pref of ['inherit', 'continuous', 'reveal', 'static']) {
    assert.ok(wizard.next({ motionPref: pref }).ok, pref);
    wizard.back();
  }
});

test('goTo cannot skip ahead past incomplete required steps', () => {
  const wizard = makeWizard();
  wizard.start();
  let res = wizard.goTo('pick-theme');
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('choose-template')));
  res = wizard.goTo('done');
  assert.equal(res.ok, false);
  // Complete steps one by one; goTo forward then works.
  wizard.next();
  wizard.next({ templateId: 'tpl-scroll' });
  wizard.next({ heroMedia: [{ name: 'hero.webm', kind: 'video' }] });
  res = wizard.goTo('preview-motion');
  assert.equal(res.ok, false, 'define-chapters + pick-theme incomplete');
  wizard.next({ chapters: [{ id: 'c1', title: 'One' }] });
  wizard.next({ themeId: 'olive-dusk' });
  res = wizard.goTo('preview-motion');
  assert.equal(res.ok, true);
  assert.equal(res.state.stepId, 'preview-motion');
});

test('back-navigation preserves recorded answers', () => {
  const wizard = walkToFirstPublish(makeWizard());
  assert.equal(wizard.back().state.stepId, 'preview-motion');
  assert.equal(wizard.back().state.stepId, 'pick-theme');
  const state = wizard.back().state;
  assert.equal(state.stepId, 'define-chapters');
  // Answers survive the round trip backwards and forwards.
  assert.equal(state.answers.templateId, 'tpl-scroll');
  assert.equal(state.answers.heroMedia[0].name, 'hero.mp4');
  assert.equal(state.answers.chapters.length, 3);
  const fwd = wizard.goTo('first-publish');
  assert.equal(fwd.ok, true);
  assert.equal(fwd.state.answers.themeId, 'warm-stone');
  // back() at the first step is an error.
  const fresh = makeWizard();
  fresh.start();
  assert.equal(fresh.back().ok, false);
});

test('first-publish requires publish target + complete checklist', () => {
  const wizard = walkToFirstPublish(makeWizard());
  // No target, project not saved yet.
  let res = wizard.next({});
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('publish target')));
  assert.ok(res.errors.some((e) => e.includes('project saved')));
  // Target given but project still unsaved.
  res = wizard.next({ publishTarget: 'lumen.hosting' });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('project saved')));
  wizard.markProjectSaved();
  res = wizard.next({ publishTarget: 'lumen.hosting' });
  assert.equal(res.ok, true);
  assert.equal(res.state.stepId, 'done');
});

test('checklistStatus() derives from accumulated wizard state', () => {
  const wizard = makeWizard();
  wizard.start();
  let status = wizard.checklistStatus();
  assert.deepEqual(status, {
    'project saved': false,
    'assets processed': false,
    'motion previewed': false,
    'publish target chosen': false,
  });
  walkToFirstPublish(wizard);
  status = wizard.checklistStatus();
  assert.deepEqual(status, {
    'project saved': false,
    'assets processed': true,
    'motion previewed': true,
    'publish target chosen': false,
  });
  wizard.markProjectSaved();
  status = wizard.checklistStatus({ publishTarget: 'lumen.hosting' });
  assert.ok(Object.values(status).every(Boolean));
});

// ------------------------------------------------------------ buildConfig --

test('buildConfig passes parseConfig for every built-in template kind', () => {
  for (const tpl of FAKE_TEMPLATES) {
    const wizard = walkToFirstPublish(makeWizard(), tpl.id);
    const config = buildConfig(wizard.state(), { templateProvider: fakeProvider, id: `cfg-${tpl.kind}` });
    assert.equal(config.template, tpl.kind);
    assert.equal(config.scenes.length, 3);
    assert.equal(config.assets.length, 1);
    assert.equal(config.assets[0].kind, 'video');
    const parsed = parseConfig(config);
    assert.ok(parsed.ok, `${tpl.kind}: ${JSON.stringify(parsed.errors)}`);
    assert.equal(parsed.config.template, tpl.kind);
  }
});

test('buildConfig maps theme tokens, chapters and motionPref into the config', () => {
  const wizard = makeWizard();
  wizard.start();
  wizard.next();
  wizard.next({ templateId: 'tpl-story' });
  wizard.next({ heroMedia: [{ name: 'cover.avif', kind: 'image' }] });
  wizard.next({
    chapters: [{ id: 'only', title: 'Solo Chapter', duration: 1800 }],
  });
  wizard.next({ themeId: 'terracotta-night' });
  wizard.next({ motionPref: 'inherit' });
  const config = buildConfig(wizard.state(), { templateProvider: fakeProvider, id: 'cfg-x' });
  const preset = listThemePresets().find((p) => p.id === 'terracotta-night');
  assert.equal(config.theme.colors['color-bg'], preset.tokens.background);
  assert.equal(config.theme.colors['color-accent'], preset.tokens.accent);
  assert.equal(config.scenes[0].slot, 'hero');
  assert.equal(config.scenes[0].track.durationOrRange, 1800);
  // 'inherit' omits a11y.motion so the template default applies.
  assert.equal(config.scenes[0].a11y.motion, undefined);
  // Image hero becomes a sprite node referencing the asset.
  const heroNode = config.scenes[0].nodes.find((n) => n.id === 'hero-media');
  assert.equal(heroNode.kind, 'sprite');
  assert.equal(heroNode.assetId, 'hero-0');
  const parsed = parseConfig(config);
  assert.ok(parsed.ok, JSON.stringify(parsed.errors));
});

test('buildConfig throws with a precise message on incomplete state', () => {
  const wizard = makeWizard();
  wizard.start();
  assert.throws(
    () => buildConfig(wizard.state(), { templateProvider: fakeProvider }),
    /missing template/,
  );
});

// -------------------------------------------------- project + draft seams --

test('createProjectFromWizard persists via ProjectStore (MemoryStorage)', async () => {
  const store = new ProjectStore(new MemoryStorage());
  const wizard = walkToFirstPublish(makeWizard());
  assert.equal(wizard.checklistStatus()['project saved'], false);
  const project = await createProjectFromWizard(store, wizard, {
    templateProvider: fakeProvider,
    name: 'My First Page',
  });
  assert.equal(project.name, 'My First Page');
  assert.equal(project.templateKind, 'scroll-video');
  assert.equal(project.templateId, 'tpl-scroll');
  assert.ok(project.id);
  // The wizard is marked saved (first-publish checklist item).
  assert.equal(wizard.checklistStatus()['project saved'], true);
  // Stored config round-trips through parseConfig.
  const listed = await store.listProjects();
  assert.equal(listed.length, 1);
  const parsed = parseConfig(listed[0].config);
  assert.ok(parsed.ok, JSON.stringify(parsed.errors));
  // Completion now possible.
  assert.equal(wizard.next({ publishTarget: 'lumen.hosting' }).ok, true);
});

test('saveDraft/resumeDraft round-trips mid-wizard (position + answers)', () => {
  const wizard = makeWizard();
  wizard.start();
  wizard.next();
  wizard.next({ templateId: 'tpl-3d' });
  wizard.next({ heroMedia: [{ name: 'hero.webp', kind: 'image' }] });
  wizard.next({ chapters: [{ id: 'c1', title: 'Intro' }] });
  assert.equal(wizard.state().stepId, 'pick-theme');

  const json = saveDraft(wizard, () => 1700000000000);
  const parsed = JSON.parse(json);
  assert.equal(parsed.draftVersion, 1);
  assert.equal(parsed.savedAt, new Date(1700000000000).toISOString());

  const resumed = resumeDraft(json, { templateProvider: fakeProvider });
  assert.equal(resumed.state().stepId, 'pick-theme');
  assert.deepEqual(resumed.state().answers, wizard.state().answers);
  // Continue from where the creator left off.
  assert.ok(resumed.next({ themeId: 'sand-dune' }).ok);
  assert.ok(resumed.next({ motionPref: 'static' }).ok);
  assert.equal(resumed.state().stepId, 'first-publish');
  const config = buildConfig(resumed.state(), { templateProvider: fakeProvider });
  assert.ok(parseConfig(config).ok);
});

test('resumeDraft rejects malformed payloads', () => {
  assert.throws(() => resumeDraft('not json'), /invalid JSON/);
  assert.throws(() => resumeDraft('{"draftVersion":99}'), /unsupported draftVersion/);
  assert.throws(
    () => resumeDraft(JSON.stringify({ draftVersion: 1, savedAt: 'x', state: {} })),
    /missing wizard state|malformed/,
  );
});

test('reset() clears answers and returns to welcome', () => {
  const wizard = walkToFirstPublish(makeWizard());
  const state = wizard.reset();
  assert.equal(state.stepId, 'welcome');
  assert.equal(state.done, false);
  assert.equal(state.projectSaved, false);
  assert.deepEqual(state.answers, { heroMedia: [], chapters: [] });
});

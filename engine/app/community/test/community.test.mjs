/**
 * @lumen/app-community — headless tests.
 *
 * Covers handle validation/uniqueness, showcase validation + listing filters
 * + featured rotation determinism, remix creating a real project with
 * attribution and counts, and comment threading/edit/soft-delete/cap/
 * ownership enforcement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMENTS_PER_TARGET_CAP,
  CommentError,
  CommentService,
  CommunityShowcase,
  MemoryCommunityStorage,
  ProfileError,
  ProfileStore,
  RemixError,
  RemixService,
  avatarColorFor,
} from '../dist/index.js';
import { ProjectStore, MemoryStorage } from '@lumen/app-projects';

/** Minimal valid v3 EngineConfig (mirrors @lumen/config tests). */
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
      {
        id: 'scroll-intro',
        source: 'scroll',
        scene: 'intro',
        inputRange: [0, 1200],
        a11yFallback: 'steps',
      },
    ],
    build: { target: 'static' },
  };
}

function templateMeta(id, categories = ['landing']) {
  return {
    id,
    name: `Template ${id}`,
    description: 'A template',
    templateKind: 'scroll-video',
    version: '1.0.0',
    categories,
    tags: ['demo'],
    thumbnail: 'data:image/svg+xml,x',
    tier: 'free',
    author: 'Someone',
    engineMinVersion: '0.1.0',
    entryConfig: validConfig(),
  };
}

function idGen(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function makeProfiles() {
  const store = new ProfileStore({
    storage: new MemoryCommunityStorage(),
    generateId: idGen('user'),
  });
  return store;
}

// ------------------------------------------------------------ profiles --

test('profile: handle validation rejects bad handles', () => {
  const profiles = makeProfiles();
  for (const bad of ['AB', 'a', 'with space', 'UPPER', 'a'.repeat(25), '__x', '']) {
    assert.throws(() => profiles.createProfile({ handle: bad, displayName: 'X' }), ProfileError);
  }
});

test('profile: create/get/byHandle, uniqueness enforced, deterministic avatar', () => {
  const profiles = makeProfiles();
  const p = profiles.createProfile({ handle: 'ada-creates', displayName: 'Ada' });
  assert.equal(p.handle, 'ada-creates');
  assert.equal(p.avatarColor, avatarColorFor('ada-creates'));
  assert.match(p.avatarColor, /^hsl\(\d+,65%,55%\)$/);
  assert.equal(profiles.getProfile(p.userId).handle, 'ada-creates');
  assert.equal(profiles.getByHandle('ada-creates').userId, p.userId);
  assert.throws(
    () => profiles.createProfile({ handle: 'ada-creates', displayName: 'Copycat' }),
    /already taken/,
  );
});

test('profile: update patches mutable fields only', () => {
  const profiles = makeProfiles();
  const p = profiles.createProfile({ handle: 'bob-99', displayName: 'Bob' });
  const updated = profiles.updateProfile(p.userId, { displayName: 'Bobby', bio: 'hi' });
  assert.equal(updated.displayName, 'Bobby');
  assert.equal(updated.bio, 'hi');
  assert.equal(updated.handle, 'bob-99');
  assert.throws(() => profiles.updateProfile('nope', { displayName: 'X' }), ProfileError);
});

// ----------------------------------------------------------- showcase --

test('showcase: template publish + validation failures', () => {
  const profiles = makeProfiles();
  const ada = profiles.createProfile({ handle: 'ada-creates', displayName: 'Ada' });
  const showcase = new CommunityShowcase(profiles, {
    storage: new MemoryCommunityStorage(),
    generateId: idGen('entry'),
  });

  const entry = showcase.showcaseTemplate(ada.userId, templateMeta('cool-landing'));
  assert.equal(entry.profileId, ada.userId);
  assert.equal(entry.meta.id, 'cool-landing');

  // Unknown author
  assert.throws(
    () => showcase.showcaseTemplate('ghost', templateMeta('x-1')),
    /unknown author/,
  );
  // Invalid entryConfig
  const bad = templateMeta('broken');
  bad.entryConfig = { version: 3 };
  assert.throws(() => showcase.showcaseTemplate(ada.userId, bad), /entryConfig failed/);
  // Duplicate by same author
  assert.throws(
    () => showcase.showcaseTemplate(ada.userId, templateMeta('cool-landing')),
    /already showcased/,
  );
});

test('showcase: listing filters + deterministic featured rotation', () => {
  const profiles = makeProfiles();
  const ada = profiles.createProfile({ handle: 'ada-creates', displayName: 'Ada' });
  const bob = profiles.createProfile({ handle: 'bob-99', displayName: 'Bob' });
  const showcase = new CommunityShowcase(profiles, {
    storage: new MemoryCommunityStorage(),
    generateId: idGen('entry'),
  });
  showcase.showcaseTemplate(ada.userId, templateMeta('t-landing', ['landing']));
  showcase.showcaseTemplate(ada.userId, templateMeta('t-story', ['storytelling']));
  showcase.showcaseTemplate(bob.userId, templateMeta('t-event', ['event']));

  assert.equal(showcase.listShowcase().length, 3);
  assert.equal(showcase.listShowcase({ category: 'landing' }).length, 1);
  assert.equal(showcase.listShowcase({ author: ada.userId }).length, 2);
  assert.equal(
    showcase.listShowcase({ category: 'event', author: bob.userId })[0].meta.id,
    't-event',
  );

  const f1 = showcase.featured('2025-01-06');
  const f2 = showcase.featured('2025-01-06');
  assert.ok(f1);
  assert.equal(f1.id, f2.id, 'featured is deterministic for a date');
});

test('showcase: project publish validation + list/get', () => {
  const profiles = makeProfiles();
  const ada = profiles.createProfile({ handle: 'ada-creates', displayName: 'Ada' });
  const showcase = new CommunityShowcase(profiles, {
    storage: new MemoryCommunityStorage(),
    generateId: idGen('entry'),
  });
  const entry = showcase.showcaseProject(ada.userId, {
    projectId: 'proj-1',
    title: 'My Site',
    description: 'A showcased project',
    configSnapshot: validConfig(),
  });
  assert.equal(entry.title, 'My Site');
  assert.equal(showcase.getProjectEntry(entry.id).projectId, 'proj-1');
  assert.equal(showcase.listProjectShowcase({ author: ada.userId }).length, 1);

  assert.throws(
    () =>
      showcase.showcaseProject(ada.userId, {
        projectId: 'proj-2',
        title: 'Broken',
        description: '',
        configSnapshot: { nope: true },
      }),
    /configSnapshot failed/,
  );
});

// -------------------------------------------------------------- remix --

test('remix: clones into a real project, attribution and counts', async () => {
  const profiles = makeProfiles();
  const ada = profiles.createProfile({ handle: 'ada-creates', displayName: 'Ada' });
  const bob = profiles.createProfile({ handle: 'bob-99', displayName: 'Bob' });
  const showcase = new CommunityShowcase(profiles, {
    storage: new MemoryCommunityStorage(),
    generateId: idGen('entry'),
  });
  const remixes = new RemixService(showcase, profiles, {
    storage: new MemoryCommunityStorage(),
  });
  const projectStore = new ProjectStore(new MemoryStorage(), { generateId: idGen('proj') });

  const entry = showcase.showcaseTemplate(ada.userId, templateMeta('cool-landing'));
  const record = await remixes.remixTemplate(entry.id, bob.userId, projectStore);

  assert.equal(record.originalId, entry.id);
  assert.equal(record.originalAuthorId, ada.userId);
  assert.equal(record.remixerId, bob.userId);

  const project = await projectStore.getProject(record.newProjectId);
  assert.ok(project, 'remix created a real project');
  assert.equal(project.templateId, 'cool-landing');
  assert.equal(project.name, 'Remix of Template cool-landing');
  assert.deepEqual(project.config, entry.meta.entryConfig);
  // Config was cloned, not aliased.
  assert.notEqual(project.config, entry.meta.entryConfig);

  assert.equal(remixes.remixCount(entry.id), 1);
  await remixes.remixTemplate(entry.id, bob.userId, projectStore);
  assert.equal(remixes.remixCount(entry.id), 2);
  assert.equal(
    remixes.attributionFor(entry.id),
    `Remixed from Template cool-landing by ada-creates`,
  );

  await assert.rejects(() => remixes.remixTemplate('missing', bob.userId, projectStore), RemixError);
  await assert.rejects(
    () => remixes.remixTemplate(entry.id, 'ghost', projectStore),
    /unknown remixer/,
  );
});

// ----------------------------------------------------------- comments --

function makeComments() {
  let tick = 0;
  return new CommentService({
    storage: new MemoryCommunityStorage(),
    generateId: idGen('c'),
    now: () => 1_000_000 + ++tick * 1000,
  });
}

test('comments: threading returns a nested chronological tree', () => {
  const comments = makeComments();
  const root1 = comments.add('target-1', 'user-1', 'first!');
  const root2 = comments.add('target-1', 'user-2', 'second root');
  const reply = comments.add('target-1', 'user-2', 'reply to first', root1.id);
  const nested = comments.add('target-1', 'user-1', 'nested reply', reply.id);
  comments.add('target-2', 'user-1', 'other target');

  const tree = comments.list('target-1');
  assert.equal(tree.length, 2);
  assert.equal(tree[0].id, root1.id);
  assert.equal(tree[0].children[0].id, reply.id);
  assert.equal(tree[0].children[0].children[0].id, nested.id);
  assert.equal(tree[1].id, root2.id);
  assert.throws(() => comments.add('target-1', 'u', 'x'.repeat(0), 'missing-parent'), CommentError);
});

test('comments: text validation 1-1000 chars', () => {
  const comments = makeComments();
  assert.throws(() => comments.add('t', 'u', '   '), CommentError);
  assert.throws(() => comments.add('t', 'u', 'x'.repeat(1001)), CommentError);
  const ok = comments.add('t', 'u', ` ${'x'.repeat(1000)} `);
  assert.equal(ok.text.length, 1000);
});

test('comments: edit/delete ownership + tombstones', () => {
  const comments = makeComments();
  const mine = comments.add('t', 'user-1', 'original');
  const edited = comments.edit(mine.id, 'user-1', 'updated');
  assert.equal(edited.text, 'updated');
  assert.ok(edited.editedAt);
  assert.equal(edited.createdAt, mine.createdAt);

  assert.throws(() => comments.edit(mine.id, 'user-2', 'hijack'), /only the author/);
  assert.throws(() => comments.delete(mine.id, 'user-2'), /only the author/);

  const reply = comments.add('t', 'user-2', 'reply', mine.id);
  const deleted = comments.delete(mine.id, 'user-1');
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.text, '');

  const tree = comments.list('t');
  assert.equal(tree[0].deleted, true, 'tombstone keeps thread shape');
  assert.equal(tree[0].children[0].id, reply.id);
  assert.throws(() => comments.edit(mine.id, 'user-1', 'revive'), /deleted/);
  assert.throws(() => comments.add('t', 'user-1', 'reply to tomb', mine.id), /deleted/);
});

test('comments: per-target cap enforced', () => {
  const comments = makeComments();
  for (let i = 0; i < COMMENTS_PER_TARGET_CAP; i++) {
    comments.add('busy', 'user-1', `comment ${i}`);
  }
  assert.equal(comments.count('busy'), COMMENTS_PER_TARGET_CAP);
  assert.throws(() => comments.add('busy', 'user-1', 'one too many'), /cap reached/);
  // Other targets unaffected.
  comments.add('quiet', 'user-1', 'fine');
});

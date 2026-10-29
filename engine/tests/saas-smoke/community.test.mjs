/**
 * tests/saas-smoke — (i) community: profile, showcase, remix creates a
 * project with attribution, comments.
 *
 * The facade's community slot is an offline stub, so this exercises the real
 * @lumen/app-community services; remix lands in the offline backend's REAL
 * ProjectStore.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineBackend } from '@lumen/backend-supabase';
import {
  CommentService,
  CommunityShowcase,
  MemoryCommunityStorage,
  ProfileStore,
  RemixService,
  avatarColorFor,
} from '@lumen/app-community';

function idGen(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** Minimal valid v3 EngineConfig for showcase/remix payloads. */
function validConfig() {
  return {
    version: 3,
    id: 'demo-site',
    template: 'scroll-video',
    meta: { title: 'Demo', description: 'A demo site', locale: 'en-US' },
    theme: { colors: { 'color-accent': '#ff0055' } },
    assets: [
      { id: 'hero-video', src: './media/hero.mp4', kind: 'video', profile: 'scrub' },
    ],
    scenes: [
      {
        id: 'intro',
        slot: 'hero',
        nodes: [{ id: 'vp', kind: 'video-plane', assetId: 'hero-video' }],
        track: { driver: 'scroll', durationOrRange: 1200 },
        a11y: { label: 'Intro section' },
      },
    ],
    interactions: [],
    build: { target: 'static' },
  };
}

function templateMeta(id) {
  return {
    id,
    name: `Template ${id}`,
    description: 'A showcased template',
    templateKind: 'scroll-video',
    version: '1.0.0',
    categories: ['landing'],
    tags: ['demo'],
    thumbnail: 'data:image/svg+xml,x',
    tier: 'free',
    author: 'Someone',
    engineMinVersion: '0.1.0',
    entryConfig: validConfig(),
  };
}

test('(i) profile → showcase → remix (attribution, real project) → comments', async () => {
  const backend = createOfflineBackend();

  // Profiles.
  const profiles = new ProfileStore({
    storage: new MemoryCommunityStorage(),
    generateId: idGen('user'),
  });
  const ada = profiles.createProfile({ handle: 'ada-creates', displayName: 'Ada' });
  const bob = profiles.createProfile({ handle: 'bob-99', displayName: 'Bob' });
  assert.equal(ada.avatarColor, avatarColorFor('ada-creates'));
  assert.equal(profiles.getByHandle('bob-99').userId, bob.userId);
  assert.throws(
    () => profiles.createProfile({ handle: 'ada-creates', displayName: 'Copycat' }),
    /already taken/,
  );

  // Showcase.
  const showcase = new CommunityShowcase(profiles, {
    storage: new MemoryCommunityStorage(),
    generateId: idGen('entry'),
  });
  const entry = showcase.showcaseTemplate(ada.userId, templateMeta('cool-landing'));
  assert.equal(entry.profileId, ada.userId);
  assert.equal(showcase.listShowcase({ category: 'landing' }).length, 1);
  assert.throws(
    () => showcase.showcaseTemplate(ada.userId, templateMeta('cool-landing')),
    /already showcased/,
  );

  // Remix: creates a REAL project in the offline backend's ProjectStore.
  const remixes = new RemixService(showcase, profiles, {
    storage: new MemoryCommunityStorage(),
  });
  const record = await remixes.remixTemplate(entry.id, bob.userId, backend.projects);
  assert.equal(record.originalId, entry.id);
  assert.equal(record.originalAuthorId, ada.userId);
  assert.equal(record.remixerId, bob.userId);

  const project = await backend.projects.getProject(record.newProjectId);
  assert.ok(project, 'remix created a real project');
  assert.equal(project.templateId, 'cool-landing');
  assert.equal(project.name, 'Remix of Template cool-landing');
  assert.deepEqual(project.config, entry.meta.entryConfig);
  assert.notEqual(project.config, entry.meta.entryConfig, 'config cloned, not aliased');

  assert.equal(remixes.remixCount(entry.id), 1);
  assert.equal(
    remixes.attributionFor(entry.id),
    'Remixed from Template cool-landing by ada-creates',
  );

  // Comments: threaded, ownership-enforced.
  const comments = new CommentService({
    storage: new MemoryCommunityStorage(),
    generateId: idGen('c'),
  });
  const root = comments.add(entry.id, bob.userId, 'Remixed — thanks!');
  const reply = comments.add(entry.id, ada.userId, 'Glad you liked it', root.id);
  const tree = comments.list(entry.id);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children[0].id, reply.id);
  assert.throws(() => comments.edit(root.id, ada.userId, 'hijack'), /only the author/);
  const edited = comments.edit(root.id, bob.userId, 'Remixed — wonderful base!');
  assert.equal(edited.text, 'Remixed — wonderful base!');
  assert.ok(edited.editedAt);
});

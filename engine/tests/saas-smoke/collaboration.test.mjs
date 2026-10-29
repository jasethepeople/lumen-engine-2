/**
 * tests/saas-smoke — (f) collaboration: share, membership roles, presence
 * heartbeat, merge suggestion on stale base.
 *
 * The facade's collaboration slot is an offline stub, so this exercises the
 * real @lumen/app-collaboration services over the offline backend's REAL
 * ProjectStore as the project seam (the same cast the Builder uses:
 * ProjectStore is structurally compatible with ProjectStoreSeam).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineBackend } from '@lumen/backend-supabase';
import {
  CollaborationService,
  ConflictResolver,
  MemoryMembershipStore,
  PresenceTracker,
  canEdit,
  canManageMembers,
} from '@lumen/app-collaboration';

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('(f) share + membership roles over the real ProjectStore seam', async () => {
  const backend = createOfflineBackend();
  const store = backend.projects;
  const project = await store.createProject({
    name: 'Team Doc',
    templateKind: 'scroll-video',
    templateId: 't-1',
    config: { a: 1 },
  });

  const seam = store;
  const memberships = new MemoryMembershipStore();
  const collab = new CollaborationService(seam, memberships);

  await collab.shareProject(project.id, 'owner-1');
  assert.equal(collab.isShared(project.id), true);
  assert.equal(await memberships.getRole(project.id, 'owner-1'), 'owner');
  assert.deepEqual(await collab.listSharedWith('owner-1'), [project.id]);
  assert.deepEqual(await collab.listSharedWith('stranger'), []);

  // Role matrix on the real helpers.
  assert.equal(canEdit('owner'), true);
  assert.equal(canEdit('editor'), true);
  assert.equal(canEdit('viewer'), false);
  assert.equal(canManageMembers('owner'), true);
  assert.equal(canManageMembers('editor'), false);

  await memberships.addMember(project.id, 'editor-1', 'editor');
  await memberships.addMember(project.id, 'viewer-1', 'viewer');
  assert.equal((await collab.checkAccess(project.id, 'editor-1', 'edit')).allowed, true);
  const viewerEdit = await collab.checkAccess(project.id, 'viewer-1', 'edit');
  assert.equal(viewerEdit.allowed, false);
  assert.equal(viewerEdit.role, 'viewer');
  assert.equal((await collab.checkAccess(project.id, 'stranger')).allowed, false);

  // Owner-only role change.
  await memberships.setRole(project.id, 'viewer-1', 'editor');
  assert.equal((await collab.checkAccess(project.id, 'viewer-1', 'edit')).allowed, true);
});

test('(f) presence heartbeat: active users, cursor, expiry', () => {
  const clock = fakeClock();
  const tracker = new PresenceTracker({ now: clock.now });
  tracker.heartbeat('u1', 'p1', 'l1:2');
  tracker.heartbeat('u2', 'p1');

  let active = tracker.activeUsers('p1');
  assert.deepEqual(active.map((e) => e.userId).sort(), ['u1', 'u2']);
  assert.equal(active.find((e) => e.userId === 'u1').cursor, 'l1:2');

  clock.advance(31_000); // u1 goes stale
  tracker.heartbeat('u2', 'p1', 'l5:5');
  active = tracker.activeUsers('p1');
  assert.deepEqual(active.map((e) => e.userId), ['u2']);
  assert.equal(active[0].cursor, 'l5:5');

  assert.equal(tracker.leave('u2', 'p1'), true);
  assert.equal(tracker.activeUsers('p1').length, 0);
});

test('(f) stale-base edit produces a merge suggestion; accept applies', async () => {
  const backend = createOfflineBackend();
  const store = backend.projects;
  const project = await store.createProject({
    name: 'Conflict Doc',
    templateKind: 'k',
    templateId: 't',
    config: { a: 1, b: 1 },
  });

  let n = 0;
  const resolver = new ConflictResolver(store, {
    now: fakeClock(5000).now,
    generateId: () => `s-${++n}`,
  });

  const v1 = (await store.listVersions(project.id)).at(-1).versionId;
  // Another editor moves head forward.
  const forward = await resolver.applyEdit(project.id, 'u2', v1, { a: 9, b: 1 });
  assert.equal(forward.applied, true);
  assert.equal(forward.suggestion, undefined, 'edit at head applies cleanly');

  // u1 edits from the stale v1 base: LWW applies AND a suggestion appears.
  const stale = await resolver.applyEdit(project.id, 'u1', v1, { a: 2, c: 7 });
  assert.equal(stale.applied, true);
  assert.ok(stale.suggestion, 'stale base must produce a merge suggestion');
  assert.equal(stale.suggestion.id, 's-1');
  assert.equal(stale.suggestion.theirVersionId, v1);
  assert.equal(stale.suggestion.status, 'pending');
  assert.deepEqual(stale.suggestion.fieldsChanged, ['a', 'b', 'c']);
  assert.deepEqual((await store.getProject(project.id)).config, { a: 2, c: 7 });

  assert.equal(resolver.listMergeSuggestions(project.id).length, 1);

  const before = (await store.listVersions(project.id)).length;
  await resolver.acceptSuggestion('s-1');
  assert.equal((await store.listVersions(project.id)).length, before + 1);
  assert.equal(resolver.listMergeSuggestions(project.id)[0].status, 'accepted');
});

/**
 * @lumen/app-collaboration — headless tests.
 *
 * Covers role permission helpers, membership adapters, share/access checks,
 * presence expiry, last-write-wins edits + merge suggestion lifecycle,
 * mock invitation lifecycle/expiry/revocation, and activity log cap/filter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ActivityLog,
  CollaborationService,
  ConflictResolver,
  InvitationService,
  LocalStorageMembershipStore,
  MemoryMembershipStore,
  PresenceTracker,
  canEdit,
  canManageMembers,
  canShare,
} from '../dist/index.js';

/** Deterministic id factory. */
function idGen(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** Mutable fake clock. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

/** Minimal in-memory ProjectStoreSeam with version history. */
function mockProjectStore() {
  const projects = new Map();
  const versions = new Map();
  const gen = idGen('v');
  return {
    async create(id, config) {
      projects.set(id, { id, config, updatedAt: new Date(0).toISOString() });
      const list = versions.get(id) ?? [];
      list.push({ versionId: gen(), projectId: id, savedAt: '', configSnapshot: structuredClone(config) });
      versions.set(id, list);
    },
    async getProject(id) {
      const p = projects.get(id);
      return p ? structuredClone(p) : undefined;
    },
    async updateProject(id, patch) {
      const p = projects.get(id);
      if (!p) throw new Error(`not found: ${id}`);
      if (patch.config !== undefined) p.config = patch.config;
      const list = versions.get(id) ?? [];
      list.push({ versionId: gen(), projectId: id, savedAt: '', configSnapshot: structuredClone(p.config) });
      versions.set(id, list);
      return structuredClone(p);
    },
    async listVersions(projectId) {
      return (versions.get(projectId) ?? []).map((v) => structuredClone(v));
    },
  };
}

test('roles: permission helpers', () => {
  assert.equal(canEdit('owner'), true);
  assert.equal(canEdit('editor'), true);
  assert.equal(canEdit('viewer'), false);
  assert.equal(canShare('owner'), true);
  assert.equal(canShare('editor'), false);
  assert.equal(canShare('viewer'), false);
  assert.equal(canManageMembers('owner'), true);
  assert.equal(canManageMembers('editor'), false);
  assert.equal(canManageMembers('viewer'), false);
});

test('membership: memory adapter CRUD', async () => {
  const store = new MemoryMembershipStore();
  await store.addMember('p1', 'u1', 'owner');
  await store.addMember('p1', 'u2', 'viewer');
  await store.addMember('p2', 'u2', 'editor');
  assert.equal(await store.getRole('p1', 'u2'), 'viewer');
  assert.deepEqual((await store.projectsFor('u2')).sort(), ['p1', 'p2']);
  await store.setRole('p1', 'u2', 'editor');
  assert.equal(await store.getRole('p1', 'u2'), 'editor');
  assert.equal((await store.listMembers('p1')).length, 2);
  assert.equal(await store.removeMember('p1', 'u2'), true);
  assert.equal(await store.removeMember('p1', 'u2'), false);
  await assert.rejects(() => store.setRole('p1', 'nope', 'viewer'));
});

test('membership: localStorage adapter round-trip and guard', async () => {
  assert.equal(LocalStorageMembershipStore.isAvailable(), false);
  const unavailable = new LocalStorageMembershipStore();
  await assert.rejects(() => unavailable.listMembers('p1'), /localStorage is not available/);

  const backing = new Map();
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  };
  try {
    const store = new LocalStorageMembershipStore({ now: () => 42 });
    await store.addMember('p1', 'u1', 'editor');
    const fresh = new LocalStorageMembershipStore();
    assert.equal(await fresh.getRole('p1', 'u1'), 'editor');
    const members = await fresh.listMembers('p1');
    assert.equal(members[0].addedAt, 42);
  } finally {
    delete globalThis.localStorage;
  }
});

test('collaboration: share, listSharedWith, access checks', async () => {
  const projects = mockProjectStore();
  await projects.create('p1', { a: 1 });
  await projects.create('p2', { b: 2 });
  const memberships = new MemoryMembershipStore();
  const svc = new CollaborationService(projects, memberships);

  await svc.shareProject('p1', 'owner1');
  assert.equal(svc.isShared('p1'), true);
  assert.equal(await memberships.getRole('p1', 'owner1'), 'owner');
  assert.deepEqual(await svc.listSharedWith('owner1'), ['p1']);
  assert.deepEqual(await svc.listSharedWith('stranger'), []);

  // Idempotent re-share keeps owner.
  await svc.shareProject('p1', 'owner1');
  assert.equal((await memberships.listMembers('p1')).length, 1);

  await assert.rejects(() => svc.shareProject('missing', 'owner1'), /not found/);

  assert.deepEqual(await svc.checkAccess('p1', 'owner1'), { allowed: true, role: 'owner' });
  await memberships.addMember('p1', 'viewer1', 'viewer');
  assert.equal((await svc.checkAccess('p1', 'viewer1')).allowed, true);
  const editCheck = await svc.checkAccess('p1', 'viewer1', 'edit');
  assert.equal(editCheck.allowed, false);
  assert.equal(editCheck.role, 'viewer');
  await memberships.addMember('p1', 'ed1', 'editor');
  assert.equal((await svc.checkAccess('p1', 'ed1', 'edit')).allowed, true);
  assert.equal((await svc.checkAccess('p1', 'stranger')).allowed, false);
  assert.equal((await svc.checkAccess('p2', 'owner1')).allowed, false); // not shared
  assert.equal((await svc.checkAccess('missing', 'owner1')).allowed, false);
});

test('presence: heartbeat, activeUsers, expiry and prune-on-read', () => {
  const clock = fakeClock();
  const tracker = new PresenceTracker({ now: clock.now });
  tracker.heartbeat('u1', 'p1', 'l1:2');
  tracker.heartbeat('u2', 'p1');
  tracker.heartbeat('u3', 'p2');

  let active = tracker.activeUsers('p1');
  assert.deepEqual(active.map((e) => e.userId).sort(), ['u1', 'u2']);
  assert.equal(active.find((e) => e.userId === 'u1').cursor, 'l1:2');

  // u1 goes stale; u2 refreshes.
  clock.advance(31_000);
  tracker.heartbeat('u2', 'p1', 'l5:5');
  active = tracker.activeUsers('p1');
  assert.deepEqual(active.map((e) => e.userId), ['u2']);
  assert.equal(active[0].cursor, 'l5:5');

  // Custom window: u2 is active within 60s but not within 10s after 20s pass.
  clock.advance(20_000);
  assert.equal(tracker.activeUsers('p1', 60_000).length, 1);
  assert.equal(tracker.activeUsers('p1', 10_000).length, 0);

  // leave() removes presence.
  tracker.heartbeat('u9', 'p1');
  assert.equal(tracker.leave('u9', 'p1'), true);
  assert.equal(tracker.leave('u9', 'p1'), false);
  assert.equal(tracker.activeUsers('p1').some((e) => e.userId === 'u9'), false);
});

test('conflicts: LWW applies against head without suggestion', async () => {
  const projects = mockProjectStore();
  await projects.create('p1', { a: 1 });
  const resolver = new ConflictResolver(projects, { generateId: idGen('s') });
  const [head] = [(await projects.listVersions('p1')).at(-1).versionId];
  const result = await resolver.applyEdit('p1', 'u1', head, { a: 2, b: 3 });
  assert.equal(result.applied, true);
  assert.equal(result.suggestion, undefined);
  assert.deepEqual((await projects.getProject('p1')).config, { a: 2, b: 3 });
  assert.deepEqual(resolver.listMergeSuggestions('p1'), []);
});

test('conflicts: stale base produces merge suggestion; accept applies', async () => {
  const projects = mockProjectStore();
  await projects.create('p1', { a: 1, b: 1 });
  const resolver = new ConflictResolver(projects, {
    now: fakeClock(5000).now,
    generateId: idGen('s'),
  });
  const v1 = (await projects.listVersions('p1')).at(-1).versionId;
  // Another edit moves head forward.
  await resolver.applyEdit('p1', 'u2', v1, { a: 9, b: 1 });
  // u1 edits from stale v1: LWW applies AND a suggestion is recorded.
  const result = await resolver.applyEdit('p1', 'u1', v1, { a: 2, c: 7 });
  assert.equal(result.applied, true);
  assert.ok(result.suggestion);
  assert.equal(result.suggestion.id, 's-1');
  assert.equal(result.suggestion.theirVersionId, v1);
  assert.equal(result.suggestion.status, 'pending');
  assert.deepEqual(result.suggestion.fieldsChanged, ['a', 'b', 'c']);
  assert.equal(result.suggestion.suggestedAt, 5000);
  // LWW: stale edit still became head.
  assert.deepEqual((await projects.getProject('p1')).config, { a: 2, c: 7 });

  const suggestions = resolver.listMergeSuggestions('p1');
  assert.equal(suggestions.length, 1);

  // Accept applies suggestion config as a new version via the store.
  const versionsBefore = (await projects.listVersions('p1')).length;
  await resolver.acceptSuggestion('s-1');
  assert.equal((await projects.listVersions('p1')).length, versionsBefore + 1);
  assert.equal(resolver.listMergeSuggestions('p1')[0].status, 'accepted');
  await assert.rejects(() => resolver.acceptSuggestion('s-1'), /already accepted/);
  assert.throws(() => resolver.dismiss('s-1'), /already accepted/);
  await assert.rejects(() => resolver.acceptSuggestion('nope'), /not found/);
});

test('conflicts: dismiss leaves store untouched', async () => {
  const projects = mockProjectStore();
  await projects.create('p1', { a: 1 });
  const resolver = new ConflictResolver(projects, { generateId: idGen('s') });
  const v1 = (await projects.listVersions('p1')).at(-1).versionId;
  await resolver.applyEdit('p1', 'u2', v1, { a: 2 });
  const { suggestion } = await resolver.applyEdit('p1', 'u1', v1, { a: 3 });
  const headBefore = (await projects.listVersions('p1')).length;
  resolver.dismiss(suggestion.id);
  assert.equal((await projects.listVersions('p1')).length, headBefore);
  assert.equal(resolver.listMergeSuggestions('p1')[0].status, 'dismissed');
  assert.throws(() => resolver.dismiss(suggestion.id), /already dismissed/);
  await assert.rejects(() => resolver.acceptSuggestion(suggestion.id), /already dismissed/);
});

test('invitations: lifecycle, expiry, revoked-token rejection', async () => {
  const clock = fakeClock();
  const memberships = new MemoryMembershipStore();
  const svc = new InvitationService(memberships, {
    now: clock.now,
    generateToken: idGen('tok'),
  });

  const { token, acceptUrl } = svc.invite('p1', 'dev@example.com', 'editor');
  assert.equal(token, 'tok-1');
  assert.equal(acceptUrl, 'lumen://invite/tok-1');
  assert.equal(svc.get(token).expiresAt, svc.get(token).createdAt + 7 * 24 * 60 * 60 * 1000);

  const member = await svc.accept(token, 'u1');
  assert.equal(member.role, 'editor');
  assert.equal(await memberships.getRole('p1', 'u1'), 'editor');

  // Revoked token cannot be accepted.
  const revoked = svc.invite('p1', 'x@example.com', 'viewer');
  assert.equal(svc.revoke(revoked.token), true);
  assert.equal(svc.revoke('missing'), false);
  await assert.rejects(() => svc.accept(revoked.token, 'u2'), /revoked/);

  // Expired token cannot be accepted (custom ttl).
  const short = new InvitationService(memberships, {
    now: clock.now,
    generateToken: idGen('short'),
    ttlMs: 1000,
  });
  const exp = short.invite('p1', 'y@example.com', 'viewer');
  clock.advance(1001);
  await assert.rejects(() => short.accept(exp.token, 'u3'), /expired/);

  // Unknown token.
  await assert.rejects(() => svc.accept('nope', 'u4'), /not found/);
  assert.throws(() => svc.invite('p1', '', 'viewer'), /email is required/);
});

test('activity log: append, cap 200, since/actor filters', () => {
  const clock = fakeClock();
  const log = new ActivityLog({ now: clock.now });
  for (let i = 0; i < 210; i++) {
    log.append('p1', { actorId: i % 2 === 0 ? 'even' : 'odd', action: `a${i}` });
    clock.advance(10);
  }
  const all = log.list('p1');
  assert.equal(all.length, 200);
  assert.equal(all[0].action, 'a10'); // oldest 10 dropped
  assert.equal(all.at(-1).action, 'a209');

  const byActor = log.list('p1', { actor: 'odd' });
  assert.equal(byActor.length, 100);
  assert.ok(byActor.every((e) => e.actorId === 'odd'));

  const sinceMid = log.list('p1', { since: all[100].at });
  assert.equal(sinceMid.length, 100);
  const both = log.list('p1', { since: all[100].at, actor: 'even' });
  assert.ok(both.every((e) => e.actorId === 'even' && e.at >= all[100].at));

  // Independent per-project buffers.
  log.append('p2', { actorId: 'x', action: 'hello', detail: 'd' });
  assert.equal(log.list('p2').length, 1);
  assert.equal(log.list('p2')[0].detail, 'd');
  assert.equal(log.list('p3').length, 0);
});

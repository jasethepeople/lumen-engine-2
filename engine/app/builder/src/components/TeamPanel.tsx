/**
 * TeamPanel — collaboration view for the currently open project, wired to
 * the real @lumen/app-collaboration services: membership (role badges +
 * owner-only role changes), mock email invitations (lumen:// accept links),
 * heartbeat presence, activity log, and the merge-suggestion inbox.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project } from '@lumen/app-projects';
import {
  canManageMembers,
  type Member,
  type MergeSuggestion,
  type Role,
} from '@lumen/app-collaboration';
import {
  USER_ID,
  activityLog,
  collaboration,
  conflictResolver,
  invitations,
  membershipStore,
  presence,
} from '../platform/services';

const PRESENCE_INTERVAL_MS = 5000;
const PRESENCE_WINDOW_MS = 15000;

const ROLE_BADGE: Record<Role, string> = {
  owner: 'border-amber-900 text-amber-300',
  editor: 'border-accent/40 text-accent',
  viewer: 'border-ink-600 text-ink-300',
};

export function TeamPanel({ project }: { project: Project | null }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [active, setActive] = useState<string[]>([]);
  const [activity, setActivity] = useState(activityLog.list(project?.id ?? ''));
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('editor');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const projectId = project?.id;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const list = await membershipStore.listMembers(projectId);
    setMembers(list);
    setActivity(activityLog.list(projectId));
    setSuggestions(conflictResolver.listMergeSuggestions(projectId));
    setShared(collaboration.isShared(projectId));
  }, [projectId]);

  // Bootstrap: ensure the local user is the owner member and the project is
  // shared through the real CollaborationService.
  useEffect(() => {
    if (!projectId) return;
    void (async () => {
      await collaboration.shareProject(projectId, USER_ID);
      activityLog.append(projectId, {
        actorId: USER_ID,
        action: 'project.shared',
        detail: 'Collaboration enabled for this project',
      });
      await refresh();
    })();
  }, [projectId, refresh]);

  // Presence heartbeat for the current user on an interval.
  useEffect(() => {
    if (!projectId) return;
    const beat = () => {
      presence.heartbeat(USER_ID, projectId, 'builder');
      setActive(presence.activeUsers(projectId, PRESENCE_WINDOW_MS).map((p) => p.userId));
    };
    beat();
    const handle = window.setInterval(beat, PRESENCE_INTERVAL_MS);
    return () => {
      window.clearInterval(handle);
      presence.leave(USER_ID, projectId);
    };
  }, [projectId]);

  const myRole = useMemo(
    () => members.find((m) => m.userId === USER_ID)?.role,
    [members],
  );
  const iManage = myRole ? canManageMembers(myRole) : false;

  if (!project) {
    return (
      <div className="h-full grid place-items-center p-8">
        <p className="text-sm text-ink-400 max-w-md text-center">
          Open a project (Projects tab → Open) to manage its team, presence,
          activity and merge suggestions.
        </p>
      </div>
    );
  }

  const changeRole = async (userId: string, role: Role) => {
    setError(null);
    try {
      await membershipStore.setRole(project.id, userId, role);
      activityLog.append(project.id, {
        actorId: USER_ID,
        action: 'member.role_changed',
        detail: `${userId} → ${role}`,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const invite = () => {
    setError(null);
    setNotice(null);
    const trimmed = email.trim();
    if (!trimmed) return;
    const result = invitations.invite(project.id, trimmed, inviteRole);
    setInviteLink(result.acceptUrl);
    activityLog.append(project.id, {
      actorId: USER_ID,
      action: 'member.invited',
      detail: `${trimmed} as ${inviteRole}`,
    });
    setEmail('');
    void refresh();
  };

  const acceptSuggestion = async (id: string) => {
    setError(null);
    try {
      await conflictResolver.acceptSuggestion(id);
      activityLog.append(project.id, {
        actorId: USER_ID,
        action: 'merge.accepted',
        detail: id,
      });
      setNotice('Merge suggestion accepted — its config is the new head version.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const dismissSuggestion = (id: string) => {
    conflictResolver.dismiss(id);
    activityLog.append(project.id, {
      actorId: USER_ID,
      action: 'merge.dismissed',
      detail: id,
    });
    void refresh();
  };

  const pending = suggestions.filter((s) => s.status === 'pending');

  return (
    <div className="h-full overflow-y-auto p-5 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="section-title mb-0">Team</h2>
        <span className="text-[10px] font-mono text-ink-400">
          {project.name} · {shared ? 'shared' : 'private'} · you are {myRole ?? 'not a member'}
        </span>
        {/* Presence bar */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="field-label mb-0">Active now</span>
          {active.length === 0 && (
            <span className="text-[10px] font-mono text-ink-500">nobody online</span>
          )}
          {active.map((userId) => (
            <span
              key={userId}
              className="text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-900 text-emerald-300"
              title="Heartbeat within the last 15s"
            >
              ● {userId}
            </span>
          ))}
        </div>
      </div>

      {notice && (
        <div className="rounded border border-emerald-900 bg-ink-950 p-3 text-xs text-emerald-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded border border-red-900 bg-ink-950 p-3 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Members */}
        <section className="card space-y-3">
          <h3 className="text-sm text-ink-100 font-semibold">Members</h3>
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2">
                <span className="font-mono text-xs text-ink-200">{m.userId}</span>
                <span
                  className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${ROLE_BADGE[m.role]}`}
                >
                  {m.role}
                </span>
                {iManage && m.userId !== USER_ID && (
                  <select
                    className="ml-auto text-xs"
                    value={m.role}
                    onChange={(e) => void changeRole(m.userId, e.target.value as Role)}
                  >
                    <option value="owner">owner</option>
                    <option value="editor">editor</option>
                    <option value="viewer">viewer</option>
                  </select>
                )}
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-800 pt-3 space-y-2">
            <span className="field-label">Invite by email</span>
            <div className="flex gap-2">
              <input
                className="flex-1"
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
              <button className="btn-primary text-xs" onClick={invite} disabled={!email.trim()}>
                Invite
              </button>
            </div>
            {inviteLink && (
              <div className="flex items-center gap-2 rounded border border-ink-700 bg-ink-950 p-2">
                <code className="flex-1 text-[11px] text-accent truncate">{inviteLink}</code>
                <button
                  className="btn text-xs"
                  onClick={() => void navigator.clipboard?.writeText(inviteLink)}
                >
                  Copy
                </button>
              </div>
            )}
            <p className="text-[10px] text-ink-500">
              Invitations are mock — share the lumen:// link; accepting it adds the member
              locally.
            </p>
          </div>
        </section>

        {/* Activity feed */}
        <section className="card space-y-3">
          <h3 className="text-sm text-ink-100 font-semibold">Activity</h3>
          {activity.length === 0 && (
            <p className="text-xs text-ink-500">No activity recorded yet.</p>
          )}
          <ul className="space-y-1.5 max-h-72 overflow-y-auto">
            {[...activity].reverse().map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="text-xs flex gap-2">
                <span className="font-mono text-ink-500 shrink-0">
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
                <span className="font-mono text-accent shrink-0">{entry.actorId}</span>
                <span className="text-ink-200">
                  {entry.action}
                  {entry.detail ? <span className="text-ink-400"> — {entry.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Merge suggestions inbox */}
      <section className="card space-y-3">
        <h3 className="text-sm text-ink-100 font-semibold">
          Merge suggestions
          <span className="ml-2 text-[10px] font-mono text-ink-400">
            {pending.length} pending
          </span>
        </h3>
        {suggestions.length === 0 && (
          <p className="text-xs text-ink-500">
            No suggestions. They appear when a collaborator applies an edit based on a stale
            version (via ConflictResolver.applyEdit).
          </p>
        )}
        <ul className="space-y-2">
          {suggestions.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded border border-ink-800 p-2"
            >
              <div className="flex-1">
                <div className="text-xs text-ink-200">
                  <span className="font-mono text-accent">{s.userId}</span> changed{' '}
                  <span className="font-mono">{s.fieldsChanged.join(', ') || 'nothing'}</span>
                </div>
                <div className="text-[10px] font-mono text-ink-500">
                  based on {s.theirVersionId.slice(0, 8)}… · head {s.headVersionId.slice(0, 8)}… ·{' '}
                  {new Date(s.suggestedAt).toLocaleString()}
                </div>
              </div>
              {s.status === 'pending' ? (
                <>
                  <button
                    className="btn-primary text-xs"
                    onClick={() => void acceptSuggestion(s.id)}
                  >
                    Accept
                  </button>
                  <button className="btn text-xs" onClick={() => dismissSuggestion(s.id)}>
                    Dismiss
                  </button>
                </>
              ) : (
                <span
                  className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                    s.status === 'accepted'
                      ? 'border-emerald-900 text-emerald-300'
                      : 'border-ink-600 text-ink-400'
                  }`}
                >
                  {s.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

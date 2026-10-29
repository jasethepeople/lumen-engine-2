/**
 * CommunityPanel — @lumen/app-community UI:
 * creator profile create/edit (ProfileStore), showcase gallery of templates
 * and projects (deterministic thumbnails / avatar colors), showcase-publish
 * for my templates and projects, remix with attribution (RemixService over
 * the real ProjectStore), and comment threads (CommentService).
 */

import { useCallback, useEffect, useState } from 'react';
import type { EngineConfig } from '@lumen/contracts';
import type { Project } from '@lumen/app-projects';
import {
  ProfileError,
  avatarColorFor,
  validateHandle,
  type CommentNode,
  type CreatorProfile,
  type ProjectShowcaseEntry,
  type TemplateShowcaseEntry,
} from '@lumen/app-community';
import {
  USER_ID,
  commentService,
  creatorTemplateStore,
  installedTemplates,
  profileStore,
  projectStore,
  remixService,
  showcase,
} from '../platform/services';

export interface CommunityPanelProps {
  onOpenProject(project: Project): void;
}

export function CommunityPanel({ onOpenProject }: CommunityPanelProps) {
  const [profile, setProfile] = useState<CreatorProfile | undefined>(() =>
    profileStore.getProfile(USER_ID),
  );
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [templates, setTemplates] = useState<TemplateShowcaseEntry[]>([]);
  const [projects, setProjects] = useState<ProjectShowcaseEntry[]>([]);
  const [myProjects, setMyProjects] = useState<Project[]>([]);
  const [comments, setComments] = useState<Record<string, CommentNode[]>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setProfile(profileStore.getProfile(USER_ID));
    const t = showcase.listShowcase();
    const p = showcase.listProjectShowcase();
    setTemplates(t);
    setProjects(p);
    setMyProjects(await projectStore.listProjects());
    const map: Record<string, CommentNode[]> = {};
    for (const e of [...t, ...p]) map[e.id] = commentService.list(e.id);
    setComments(map);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProfile = () => {
    setError(null);
    const issue = validateHandle(handle);
    if (issue) {
      setError(issue);
      return;
    }
    try {
      const created = profileStore.createProfile({
        handle: handle.trim(),
        displayName: displayName.trim() || handle.trim(),
        bio: bio.trim() || undefined,
      });
      setProfile(created);
      setNotice(`Welcome, @${created.handle}!`);
    } catch (err) {
      setError(err instanceof ProfileError ? err.message : String(err));
    }
  };

  const saveProfile = () => {
    setError(null);
    try {
      const updated = profileStore.updateProfile(USER_ID, {
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || undefined,
      });
      setProfile(updated);
      setNotice('Profile updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const showcaseMyTemplate = (templateId: string) => {
    if (!profile) return;
    setError(null);
    const record = creatorTemplateStore.get(templateId);
    if (!record) {
      setError('Only templates you uploaded (Marketplace → Creator) can be showcased.');
      return;
    }
    try {
      showcase.showcaseTemplate(profile.userId, record.meta);
      setNotice(`Showcased template "${record.meta.name}".`);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const showcaseMyProject = async (project: Project) => {
    if (!profile) return;
    setError(null);
    try {
      showcase.showcaseProject(profile.userId, {
        projectId: project.id,
        title: project.name,
        description: ((project.config as EngineConfig | undefined)?.meta?.description as
          | string
          | undefined) ?? '',
        configSnapshot: project.config,
      });
      setNotice(`Showcased project "${project.name}".`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remix = async (entryId: string) => {
    setError(null);
    try {
      const record = await remixService.remixTemplate(entryId, USER_ID, projectStore);
      setNotice(
        `Remixed into a new project. ${remixService.attributionFor(record.originalId)}`,
      );
      const project = await projectStore.getProject(record.newProjectId);
      if (project) onOpenProject(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const addComment = (targetId: string, parentId?: string) => {
    setError(null);
    const text = (draft[parentId ?? targetId] ?? '').trim();
    if (!text) return;
    try {
      commentService.add(targetId, USER_ID, text, parentId);
      setDraft((d) => ({ ...d, [parentId ?? targetId]: '' }));
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const myTemplates = creatorTemplateStore.list().filter((r) => r.authorId === USER_ID);
  const installed = installedTemplates.list();

  const renderComments = (entryId: string) => {
    const nodes = comments[entryId] ?? [];
    const renderNode = (n: CommentNode, depth: number) => (
      <li key={n.id} className={depth > 0 ? 'ml-4 border-l border-ink-800 pl-2' : ''}>
        <div className="text-xs">
          <span className="font-mono text-accent">{n.authorId}</span>{' '}
          <span className="text-ink-200">{n.deleted ? '(deleted)' : n.text}</span>
          <span className="text-ink-500 font-mono"> · {new Date(n.createdAt).toLocaleString()}</span>
        </div>
        <div className="flex gap-1 mt-0.5">
          <input
            className="flex-1 text-xs"
            placeholder="Reply…"
            value={draft[n.id] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [n.id]: e.target.value }))}
          />
          <button className="btn text-xs" onClick={() => addComment(entryId, n.id)}>
            Reply
          </button>
        </div>
        {n.children.length > 0 && (
          <ul className="space-y-1 mt-1">{n.children.map((c) => renderNode(c, depth + 1))}</ul>
        )}
      </li>
    );
    return (
      <div className="space-y-1.5">
        <ul className="space-y-1.5">{nodes.map((n) => renderNode(n, 0))}</ul>
        <div className="flex gap-1">
          <input
            className="flex-1 text-xs"
            placeholder="Add a comment…"
            value={draft[entryId] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [entryId]: e.target.value }))}
          />
          <button className="btn text-xs" onClick={() => addComment(entryId)}>
            Comment
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-5 space-y-4">
      <h2 className="section-title mb-0">Community</h2>

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

      {/* Profile */}
      <section className="card space-y-3">
        <h3 className="text-sm text-ink-100 font-semibold">My creator profile</h3>
        {profile ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span
                className="w-10 h-10 rounded-full grid place-items-center text-sm font-bold text-ink-950"
                style={{ backgroundColor: avatarColorFor(profile.handle) }}
              >
                {profile.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <div className="text-sm text-ink-100">
                  {profile.displayName}{' '}
                  <span className="font-mono text-ink-400">@{profile.handle}</span>
                </div>
                <div className="text-xs text-ink-400">{profile.bio ?? 'No bio yet.'}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={profile.displayName}
              />
              <input
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder={profile.bio ?? 'Bio'}
              />
            </div>
            <button className="btn text-xs" onClick={saveProfile}>
              Save profile
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="handle (a-z0-9-_)"
              />
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
              />
              <input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio" />
            </div>
            <button className="btn-primary text-xs" onClick={createProfile} disabled={!handle.trim()}>
              Create profile
            </button>
          </div>
        )}
      </section>

      {/* Showcase publish actions */}
      {profile && (
        <section className="card space-y-2">
          <h3 className="text-sm text-ink-100 font-semibold">Showcase my work</h3>
          <div className="flex gap-2 flex-wrap items-center">
            <span className="field-label mb-0">Templates</span>
            {myTemplates.length === 0 && (
              <span className="text-xs text-ink-500">
                none uploaded (Marketplace → Creator)
              </span>
            )}
            {myTemplates.map((r) => (
              <button
                key={r.meta.id}
                className="btn text-xs"
                onClick={() => showcaseMyTemplate(r.meta.id)}
              >
                Showcase {r.meta.name}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <span className="field-label mb-0">Projects</span>
            {myProjects.length === 0 && (
              <span className="text-xs text-ink-500">no projects yet</span>
            )}
            {myProjects.map((p) => (
              <button
                key={p.id}
                className="btn text-xs"
                onClick={() => void showcaseMyProject(p)}
              >
                Showcase {p.name}
              </button>
            ))}
          </div>
          {installed.length > 0 && (
            <p className="text-[10px] text-ink-500">
              {installed.length} installed template{installed.length === 1 ? '' : 's'} — upload
              your own to showcase templates here.
            </p>
          )}
        </section>
      )}

      {/* Gallery */}
      <section className="space-y-3">
        <h3 className="text-sm text-ink-100 font-semibold">Showcase gallery</h3>
        {templates.length === 0 && projects.length === 0 && (
          <p className="text-xs text-ink-500">Nothing showcased yet — be the first.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {templates.map((entry) => (
            <div key={entry.id} className="card space-y-2">
              <img
                src={entry.meta.thumbnail}
                alt={entry.meta.name}
                className="w-full h-28 object-cover rounded border border-ink-800"
              />
              <div className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-full"
                  style={{ backgroundColor: avatarColorFor(entry.profileId) }}
                />
                <span className="text-sm text-ink-100">{entry.meta.name}</span>
                <span className="text-[10px] font-mono text-ink-500">
                  template · {remixService.remixCount(entry.id)} remixes
                </span>
              </div>
              <p className="text-xs text-ink-300 line-clamp-2">{entry.meta.description}</p>
              <div className="text-[10px] font-mono text-ink-500">
                {remixService.attributionFor(entry.id)}
              </div>
              <div className="flex gap-2">
                <button className="btn-primary text-xs" onClick={() => void remix(entry.id)}>
                  Remix
                </button>
              </div>
              {renderComments(entry.id)}
            </div>
          ))}
          {projects.map((entry) => (
            <div key={entry.id} className="card space-y-2">
              {entry.thumbnail ? (
                <img
                  src={entry.thumbnail}
                  alt={entry.title}
                  className="w-full h-28 object-cover rounded border border-ink-800"
                />
              ) : (
                <div
                  className="w-full h-28 rounded border border-ink-800 grid place-items-center text-lg font-bold text-ink-950"
                  style={{ backgroundColor: avatarColorFor(entry.title) }}
                >
                  {entry.title}
                </div>
              )}
              <div className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-full"
                  style={{ backgroundColor: avatarColorFor(entry.profileId) }}
                />
                <span className="text-sm text-ink-100">{entry.title}</span>
                <span className="text-[10px] font-mono text-ink-500">project</span>
              </div>
              <p className="text-xs text-ink-300 line-clamp-2">{entry.description}</p>
              {renderComments(entry.id)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

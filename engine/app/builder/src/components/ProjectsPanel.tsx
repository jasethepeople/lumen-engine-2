/**
 * ProjectsPanel — project management over the real @lumen/app-projects
 * ProjectStore (LocalStorageAdapter in the browser): list / create /
 * duplicate / delete, open into the editor, and version history with
 * restore. Autosave itself is driven by App (AutosaveManager.schedule on
 * every validated edit); this panel surfaces the recorded versions.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Project, ProjectVersion } from '@lumen/app-projects';
import type { EngineConfig } from '@lumen/contracts';
import { listTemplates } from '@lumen/app-runtime';
import { autosave, projectStore, telemetry } from '../platform/services';

export interface ProjectsPanelProps {
  /** Currently open project (if any). */
  openProject: Project | null;
  /** Current editor config — used to seed newly created projects. */
  seedConfig: EngineConfig | null;
  /** Open a project's config in the editor. */
  onOpen(project: Project): void;
  /** Close the current project (back to scratch editing). */
  onClose(): void;
  /** True when an autosave for the open project is still debouncing. */
  saving: boolean;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ProjectsPanel({
  openProject,
  seedConfig,
  onOpen,
  onClose,
  saving,
}: ProjectsPanelProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState<string>(() => listTemplates()[0]?.kind ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const templates = listTemplates();

  const refresh = useCallback(async () => {
    setProjects(await projectStore.listProjects());
  }, []);

  const refreshVersions = useCallback(async () => {
    if (!openProject) {
      setVersions([]);
      return;
    }
    const list = await projectStore.listVersions(openProject.id);
    setVersions([...list].reverse()); // newest first
  }, [openProject]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshVersions();
  }, [refreshVersions, saving]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const name = newName.trim() || 'Untitled project';
      const project = await projectStore.createProject({
        name,
        templateKind: newTemplate,
        templateId: newTemplate,
        config: seedConfig ?? undefined,
      });
      telemetry.track('builder.project.created', {
        projectId: project.id,
        template: newTemplate,
        source: 'projects-panel',
      });
      setNewName('');
      await refresh();
      onOpen(project);
    });

  const duplicate = (p: Project) =>
    run(async () => {
      await projectStore.duplicateProject(p.id, `${p.name} copy`);
      await refresh();
    });

  const remove = (p: Project) =>
    run(async () => {
      if (!window.confirm(`Delete project "${p.name}" and its version history?`)) return;
      autosave.cancel(p.id);
      await projectStore.deleteProject(p.id);
      if (openProject?.id === p.id) onClose();
      await refresh();
    });

  const restore = (versionId: string) =>
    run(async () => {
      if (!openProject) return;
      const restored = await projectStore.restoreVersion(openProject.id, versionId);
      await refreshVersions();
      onOpen(restored); // reload restored config into the editor
    });

  return (
    <div className="p-5 max-w-4xl mx-auto space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <h2 className="section-title mb-0">Projects</h2>
        {openProject && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-ink-700 text-ink-300">
            editing: {openProject.name}
            {saving ? ' · saving…' : ' · saved'}
          </span>
        )}
        {openProject && (
          <button className="btn text-xs ml-auto" onClick={onClose}>
            Close project
          </button>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-900 bg-ink-950 p-3 text-xs text-red-200 font-mono">
          {error}
        </div>
      )}

      {/* Create */}
      <div className="card">
        <div className="section-title">New project</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="flex-1 min-w-48"
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <select value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.kind}>
                {t.id}
              </option>
            ))}
          </select>
          <button className="btn-primary" disabled={busy} onClick={() => void create()}>
            Create
          </button>
        </div>
        <p className="text-[11px] text-ink-400 mt-2">
          New projects start empty — open one, then edit in the Editor tab. Every validated
          edit is autosaved (debounced) and appended to the version history.
        </p>
      </div>

      {/* List */}
      <div className="card">
        <div className="section-title">Your projects ({projects.length})</div>
        {projects.length === 0 && (
          <p className="text-sm text-ink-400">
            No projects yet — create one above or run the onboarding wizard.
          </p>
        )}
        <ul className="divide-y divide-ink-800">
          {projects.map((p) => (
            <li key={p.id} className="py-2 flex items-center gap-3">
              <div className="min-w-0">
                <div className="text-sm text-ink-100 truncate">{p.name}</div>
                <div className="text-[10px] font-mono text-ink-400">
                  {p.templateId} · updated {formatTime(p.updatedAt)}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button className="btn text-xs" disabled={busy} onClick={() => onOpen(p)}>
                  Open
                </button>
                <button className="btn text-xs" disabled={busy} onClick={() => void duplicate(p)}>
                  Duplicate
                </button>
                <button className="btn-danger text-xs" disabled={busy} onClick={() => void remove(p)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Version history for the open project */}
      {openProject && (
        <div className="card">
          <div className="section-title">Version history — {openProject.name}</div>
          {versions.length === 0 && (
            <p className="text-sm text-ink-400">No versions recorded yet.</p>
          )}
          <div className="flex items-center gap-2">
            <select
              id="version-select"
              className="flex-1"
              defaultValue=""
              onChange={() => undefined}
            >
              <option value="" disabled>
                {versions.length} version{versions.length === 1 ? '' : 's'} recorded
              </option>
              {versions.map((v) => (
                <option key={v.versionId} value={v.versionId}>
                  {formatTime(v.savedAt)}
                  {v.label ? ` — ${v.label}` : ''}
                </option>
              ))}
            </select>
            <button
              className="btn text-xs"
              disabled={busy || versions.length === 0}
              onClick={() => {
                const sel = document.getElementById('version-select') as HTMLSelectElement | null;
                if (sel?.value) void restore(sel.value);
              }}
            >
              Restore selected
            </button>
          </div>
          <p className="text-[11px] text-ink-400 mt-2">
            Restoring never rewrites history: it records a new version whose snapshot is the
            restored config, and reloads it into the editor.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * DashboardPanel — @lumen/app-dashboard UI:
 * overview cards, project table with latest publish status, per-project
 * publish history with rollback, local analytics bar charts (AnalyticsStore),
 * preview-before-publish (PreviewService.createPreview → real bundle budgets
 * + PreviewPanel of the project config), and share-preview-link generation.
 */

import { useCallback, useEffect, useState } from 'react';
import type { EngineConfig } from '@lumen/contracts';
import type { PublishRecord } from '@lumen/app-publish';
import type { AnalyticsStats, DashboardOverview, DashboardProject, PreviewInfo, ShareLink } from '@lumen/app-dashboard';
import {
  analyticsStore,
  dashboardService,
  previewService,
  projectStore,
} from '../platform/services';
import { PreviewPanel } from './PreviewPanel';

export function DashboardPanel({ reducedMotion }: { reducedMotion: boolean }) {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [history, setHistory] = useState<PublishRecord[]>([]);
  const [stats, setStats] = useState<AnalyticsStats | null>(null);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [previewConfig, setPreviewConfig] = useState<EngineConfig | null>(null);
  const [share, setShare] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setOverview(await dashboardService.overview());
    setProjects(await dashboardService.listProjects());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = useCallback((projectId: string) => {
    setSelectedId(projectId);
    setShare(null);
    setHistory(dashboardService.publishHistory(projectId));
    setStats(analyticsStore.stats(projectId, { days: 14 }));
  }, []);

  const rollback = async (recordId: string) => {
    setError(null);
    try {
      const rec = await dashboardService.rollback(selectedId, recordId);
      setNotice(`Rolled back to ${rec.url}`);
      select(selectedId);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openPreview = async (projectId: string) => {
    setBusy(true);
    setError(null);
    try {
      const info = await previewService.createPreview(projectId);
      // Seed a local analytics view on each preview open.
      analyticsStore.recordView(projectId, { source: 'builder-preview' });
      const project = await projectStore.getProject(projectId);
      setPreview(info);
      setPreviewConfig((project?.config as EngineConfig | undefined) ?? null);
      if (selectedId === projectId) select(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const sharePreview = () => {
    if (!preview) return;
    const link = previewService.sharePreview(preview.previewId);
    setShare(link);
    void navigator.clipboard?.writeText(link.url);
  };

  const selected = projects.find((p) => p.id === selectedId);
  const maxViews = Math.max(1, ...(stats?.viewsByDay.map((d) => d.views) ?? [1]));

  return (
    <div className="h-full overflow-y-auto p-5 space-y-4">
      <h2 className="section-title mb-0">Dashboard</h2>

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

      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Projects', value: overview?.projectCount ?? '—' },
          { label: 'Live', value: overview?.liveCount ?? '—' },
          { label: 'Total publishes', value: overview?.totalPublishes ?? '—' },
          {
            label: 'Last publish',
            value: overview?.lastPublishAt
              ? new Date(overview.lastPublishAt).toLocaleDateString()
              : 'never',
          },
        ].map((c) => (
          <div key={c.label} className="card">
            <div className="field-label mb-0">{c.label}</div>
            <div className="text-2xl text-ink-100 font-semibold">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Project table */}
      <section className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink-400 border-b border-ink-800">
              <th className="py-1 pr-3 font-medium">Project</th>
              <th className="py-1 pr-3 font-medium">Versions</th>
              <th className="py-1 pr-3 font-medium">Publishes</th>
              <th className="py-1 pr-3 font-medium">Status</th>
              <th className="py-1 pr-3 font-medium">Live URL</th>
              <th className="py-1 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr
                key={p.id}
                className={`border-b border-ink-800/50 cursor-pointer hover:bg-ink-900/40 ${
                  p.id === selectedId ? 'bg-ink-900/60' : ''
                }`}
                onClick={() => select(p.id)}
              >
                <td className="py-1.5 pr-3 text-ink-100">{p.name}</td>
                <td className="py-1.5 pr-3 font-mono text-ink-300">{p.versionCount}</td>
                <td className="py-1.5 pr-3 font-mono text-ink-300">{p.publishCount}</td>
                <td className="py-1.5 pr-3">
                  <span
                    className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                      p.publishStatus === 'live'
                        ? 'border-emerald-900 text-emerald-300'
                        : p.publishStatus === 'rolled-back'
                          ? 'border-amber-900 text-amber-300'
                          : 'border-ink-600 text-ink-400'
                    }`}
                  >
                    {p.publishStatus}
                  </span>
                </td>
                <td className="py-1.5 pr-3 font-mono text-accent">{p.liveUrl ?? '—'}</td>
                <td className="py-1.5">
                  <button
                    className="btn text-xs disabled:opacity-40"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void openPreview(p.id);
                    }}
                  >
                    Preview before publish
                  </button>
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-ink-500">
                  No projects yet — create one in the Projects tab.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Publish history */}
          <section className="card space-y-2">
            <h3 className="text-sm text-ink-100 font-semibold">
              Publish history — {selected.name}
            </h3>
            {history.length === 0 && (
              <p className="text-xs text-ink-500">Never published.</p>
            )}
            <ul className="space-y-1.5">
              {history.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
                      r.status === 'live'
                        ? 'border-emerald-900 text-emerald-300'
                        : 'border-amber-900 text-amber-300'
                    }`}
                  >
                    {r.status}
                  </span>
                  <span className="font-mono text-accent">{r.url}</span>
                  <span className="text-ink-500 font-mono">
                    {new Date(r.publishedAt).toLocaleString()}
                  </span>
                  {r.status === 'live' && (
                    <button className="btn text-xs ml-auto" onClick={() => void rollback(r.id)}>
                      Rollback
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Analytics */}
          <section className="card space-y-2">
            <h3 className="text-sm text-ink-100 font-semibold">
              Views (last {stats?.days ?? 14} days)
              <span className="ml-2 text-[10px] font-mono text-ink-400">
                {stats?.views ?? 0} total
              </span>
            </h3>
            <div className="flex items-end gap-1 h-24">
              {(stats?.viewsByDay ?? []).map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-accent/60 rounded-sm"
                    style={{ height: `${(d.views / maxViews) * 80}px` }}
                    title={`${d.day}: ${d.views} views`}
                  />
                  <span className="text-[8px] font-mono text-ink-500">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-ink-500">
              Local-only analytics — a view is recorded each time a preview is opened.
            </p>
          </section>
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <div
          className="fixed inset-0 bg-black/70 grid place-items-center z-50 p-6"
          onClick={() => {
            setPreview(null);
            setShare(null);
          }}
        >
          <div
            className="card max-w-3xl w-full space-y-3 max-h-full overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="text-sm text-ink-100 font-semibold">
                Preview — {preview.projectName}
              </h3>
              <span className="text-[10px] font-mono text-ink-400">
                expires {new Date(preview.expiresAt).toLocaleString()}
              </span>
              <span className="text-[10px] font-mono text-ink-400">
                {preview.bundle.files.size} files · budgets{' '}
                {preview.budgets.passed ? (
                  <span className="text-emerald-300">ok</span>
                ) : (
                  <span className="text-red-300">exceeded</span>
                )}
              </span>
              <button className="btn text-xs ml-auto" onClick={sharePreview}>
                Share preview link
              </button>
              <button
                className="btn text-xs"
                onClick={() => {
                  setPreview(null);
                  setShare(null);
                }}
              >
                Close
              </button>
            </div>
            {share && (
              <div className="flex items-center gap-2 rounded border border-ink-700 bg-ink-950 p-2">
                <code className="flex-1 text-[11px] text-accent truncate">{share.url}</code>
                <span className="text-[10px] font-mono text-ink-400">
                  expires {new Date(share.expiresAt).toLocaleString()}
                </span>
                <button
                  className="btn text-xs"
                  onClick={() => void navigator.clipboard?.writeText(share.url)}
                >
                  Copy
                </button>
              </div>
            )}
            <div className="h-80 rounded border border-ink-800 overflow-hidden">
              <PreviewPanel config={previewConfig} reducedMotion={reducedMotion} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

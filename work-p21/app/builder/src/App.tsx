import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineConfig, TemplateKind } from '@lumen/contracts';
import type { Project } from '@lumen/app-projects';
import { getThemePreset, resolveReducedMotion } from '@lumen/app-settings';
import { listTemplates } from '@lumen/app-runtime';
import { useConfigState } from './state/useConfig';
import {
  AssetsEditor,
  InteractionsEditor,
  MetaEditor,
  ScenesEditor,
  ThemeEditor,
} from './components/Editors';
import { JsonEditor } from './components/JsonEditor';
import { PreviewPanel } from './components/PreviewPanel';
import { ExportPanel } from './components/ExportPanel';
import { ProjectsPanel } from './components/ProjectsPanel';
import { OnboardingWizardView } from './components/OnboardingWizardView';
import { MarketplacePanel } from './components/MarketplacePanel';
import { AssetsPanel } from './components/AssetsPanel';
import { PublishPanel } from './components/PublishPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { TeamPanel } from './components/TeamPanel';
import { AIAssistantPanel } from './components/AIAssistantPanel';
import { MotionDesignerPanel } from './components/MotionDesignerPanel';
import { DashboardPanel } from './components/DashboardPanel';
import { CommunityPanel } from './components/CommunityPanel';
import { autosave, projectStore, settingsStore } from './platform/services';
import { useSettings, useSystemPrefersReducedMotion } from './platform/hooks';

type LeftTab = 'design' | 'json';
type Section = 'meta' | 'theme' | 'scenes' | 'assets' | 'interactions';
type View =
  | 'editor'
  | 'projects'
  | 'onboarding'
  | 'marketplace'
  | 'assets'
  | 'publish'
  | 'settings'
  | 'team'
  | 'ai'
  | 'designer'
  | 'dashboard'
  | 'community';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'meta', label: 'Meta' },
  { id: 'theme', label: 'Theme' },
  { id: 'scenes', label: 'Scenes' },
  { id: 'assets', label: 'Assets' },
  { id: 'interactions', label: 'Interactions' },
];

const VIEWS: { id: View; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'projects', label: 'Projects' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'assets', label: 'Assets' },
  { id: 'publish', label: 'Publish' },
  { id: 'team', label: 'Team' },
  { id: 'ai', label: 'AI' },
  { id: 'designer', label: 'Designer' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'community', label: 'Community' },
  { id: 'settings', label: 'Settings' },
];

const WELCOMED_KEY = 'lumen.builder.welcomed';

function serialize(cfg: EngineConfig): string {
  return JSON.stringify(cfg, null, 2) + '\n';
}

export default function App() {
  const state = useConfigState();
  const [tab, setTab] = useState<LeftTab>('design');
  const [section, setSection] = useState<Section>('scenes');
  const [view, setView] = useState<View>(() => {
    try {
      return globalThis.localStorage?.getItem(WELCOMED_KEY) ? 'editor' : 'onboarding';
    } catch {
      return 'editor';
    }
  });
  const [openProject, setOpenProject] = useState<Project | null>(null);
  const [saving, setSaving] = useState(false);
  const templates = useMemo(() => listTemplates(), []);

  // ---- Settings-driven chrome + preview --------------------------------
  const settings = useSettings();
  const systemPrefersReduced = useSystemPrefersReducedMotion();
  const effectiveReduced = resolveReducedMotion(settings, systemPrefersReduced);
  const preset = getThemePreset(settings.themePreset);

  const markWelcomed = () => {
    try {
      globalThis.localStorage?.setItem(WELCOMED_KEY, '1');
    } catch {
      /* non-persistent environments */
    }
  };

  // ---- Project open/close ----------------------------------------------
  const openProjectInEditor = useCallback(
    (project: Project) => {
      setOpenProject(project);
      if (project.config) {
        try {
          state.setText(serialize(project.config as EngineConfig));
        } catch {
          /* keep the current editor buffer if the snapshot is malformed */
        }
      }
      setView('editor');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.setText],
  );

  const closeProject = useCallback(async () => {
    if (openProject) await autosave.flush();
    setOpenProject(null);
  }, [openProject]);

  // ---- Autosave: debounced via the real AutosaveManager -----------------
  const lastSavedConfig = useRef<string>('');
  useEffect(() => {
    if (!openProject || !state.valid || !state.config) return;
    const serialized = serialize(state.config);
    if (serialized === lastSavedConfig.current) return;
    lastSavedConfig.current = serialized;
    autosave.schedule(openProject.id, state.config);
    setSaving(true);
    const handle = window.setTimeout(() => {
      setSaving(autosave.isPending(openProject.id));
    }, 700);
    return () => window.clearTimeout(handle);
  }, [openProject, state.config, state.valid]);

  // Flush pending autosaves on unload.
  useEffect(() => {
    const flush = () => void autosave.flush();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  const saveCurrentAsProject = useCallback(async () => {
    if (!state.config) return;
    const project = await projectStore.createProject({
      name: (state.config.meta?.title as string | undefined) ?? 'Untitled project',
      templateKind: state.config.template,
      templateId: state.config.template,
      config: state.config,
    });
    setOpenProject(project);
  }, [state.config]);

  const themeStyle = preset
    ? ({
        backgroundColor: preset.tokens.background,
        color: preset.tokens.text,
        fontFamily: preset.tokens.fontFamily,
      } as const)
    : undefined;

  return (
    <div className="h-full flex flex-col" style={themeStyle}>
      {preset && (
        <style>{`.btn-primary{color:${preset.tokens.accent};border-color:${preset.tokens.accent}66}`}</style>
      )}
      <header
        className="flex items-center gap-4 px-5 py-3 border-b border-ink-800"
        style={preset ? { backgroundColor: preset.tokens.surface } : undefined}
      >
        <h1 className="text-sm font-semibold tracking-[0.25em] uppercase text-ink-100">
          Lumen <span className="text-ink-400">Builder</span>
        </h1>
        <nav className="flex items-center gap-1 ml-4">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`px-2.5 py-1 rounded text-[11px] uppercase tracking-wider ${
                view === v.id
                  ? 'bg-ink-800 text-ink-100 border border-ink-600'
                  : 'text-ink-400 hover:text-ink-200'
              }`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {openProject && (
            <span className="text-[10px] font-mono text-ink-400 border border-ink-700 rounded px-2 py-0.5">
              {openProject.name}
              {saving ? ' · saving…' : ' · autosaved'}
            </span>
          )}
          {!state.valid && (
            <span className="text-[10px] font-mono text-red-300 border border-red-900 rounded px-2 py-0.5">
              invalid config
            </span>
          )}
        </div>
      </header>

      {view === 'editor' && (
        <>
          <div className="flex items-center gap-4 px-5 py-2 border-b border-ink-800">
            <div className="flex items-center gap-2">
              <span className="field-label mb-0">Template</span>
              <select
                value={state.config?.template ?? ''}
                onChange={(e) =>
                  state.update((c) => void (c.template = e.target.value as TemplateKind))
                }
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.kind}>
                    {t.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {(['design', 'json'] as LeftTab[]).map((t) => (
                <button
                  key={t}
                  className={`px-3 py-1 rounded text-xs uppercase tracking-wider ${
                    tab === t ? 'bg-ink-800 text-ink-100 border border-ink-600' : 'text-ink-400'
                  }`}
                  onClick={() => setTab(t)}
                >
                  {t === 'design' ? 'Design' : 'Raw JSON'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 grid grid-cols-[minmax(420px,34rem)_1fr] min-h-0">
            {/* Left: config editor */}
            <div className="flex flex-col border-r border-ink-800 min-h-0">
              {tab === 'design' ? (
                <>
                  <nav className="flex gap-1 px-4 pt-3">
                    {SECTIONS.map((s) => (
                      <button
                        key={s.id}
                        className={`px-2.5 py-1 rounded text-[11px] uppercase tracking-wider ${
                          section === s.id
                            ? 'bg-ink-800 text-ink-100 border border-ink-600'
                            : 'text-ink-400 hover:text-ink-200'
                        }`}
                        onClick={() => setSection(s.id)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </nav>
                  <div className="flex-1 overflow-y-auto p-4">
                    {state.config && section === 'meta' && (
                      <MetaEditor config={state.config} update={state.update} />
                    )}
                    {state.config && section === 'theme' && (
                      <ThemeEditor config={state.config} update={state.update} />
                    )}
                    {state.config && section === 'scenes' && (
                      <ScenesEditor config={state.config} update={state.update} />
                    )}
                    {state.config && section === 'assets' && (
                      <AssetsEditor config={state.config} update={state.update} />
                    )}
                    {state.config && section === 'interactions' && (
                      <InteractionsEditor config={state.config} update={state.update} />
                    )}
                    {!state.config && (
                      <p className="text-sm text-ink-400">
                        The config is invalid — fix it in the Raw JSON tab.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 min-h-0">
                  <JsonEditor
                    text={state.text}
                    parsed={state.parsed}
                    config={state.config}
                    setText={state.setText}
                  />
                </div>
              )}
              {state.config && <ExportPanel config={state.config} text={state.text} />}
            </div>

            {/* Right: live preview (reduced motion resolved from settings) */}
            <div className="min-h-0">
              <PreviewPanel
                config={state.config}
                reducedMotion={effectiveReduced}
                onReducedMotionChange={(reduced) =>
                  settingsStore.patch({ reducedMotion: reduced ? 'on' : 'off' })
                }
              />
            </div>
          </div>
        </>
      )}

      {view === 'projects' && (
        <div className="flex-1 min-h-0">
          <ProjectsPanel
            openProject={openProject}
            seedConfig={state.config}
            saving={saving}
            onOpen={openProjectInEditor}
            onClose={() => void closeProject()}
          />
        </div>
      )}

      {view === 'onboarding' && (
        <div className="flex-1 min-h-0">
          <OnboardingWizardView
            onFinish={(project) => {
              markWelcomed();
              openProjectInEditor(project);
            }}
            onSkip={() => {
              markWelcomed();
              setView('editor');
            }}
          />
        </div>
      )}

      {view === 'marketplace' && (
        <div className="flex-1 min-h-0">
          <MarketplacePanel />
        </div>
      )}

      {view === 'assets' && (
        <div className="flex-1 min-h-0">
          <AssetsPanel />
        </div>
      )}

      {view === 'publish' && (
        <div className="flex-1 min-h-0">
          <PublishPanel
            project={openProject}
            currentConfig={state.config}
            onSaveAsProject={() => void saveCurrentAsProject()}
          />
        </div>
      )}

      {view === 'team' && (
        <div className="flex-1 min-h-0">
          <TeamPanel project={openProject} />
        </div>
      )}

      {view === 'ai' && (
        <div className="flex-1 min-h-0">
          <AIAssistantPanel
            config={state.valid ? state.config : null}
            reducedMotion={effectiveReduced}
            onLoadIntoEditor={(cfg) => {
              state.setText(serialize(cfg));
              setView('editor');
            }}
            onOpenProject={openProjectInEditor}
          />
        </div>
      )}

      {view === 'designer' && (
        <div className="flex-1 min-h-0">
          <MotionDesignerPanel
            config={state.valid ? state.config : null}
            onSave={(cfg) => {
              state.setText(serialize(cfg));
              setView('editor');
            }}
          />
        </div>
      )}

      {view === 'dashboard' && (
        <div className="flex-1 min-h-0">
          <DashboardPanel reducedMotion={effectiveReduced} />
        </div>
      )}

      {view === 'community' && (
        <div className="flex-1 min-h-0">
          <CommunityPanel onOpenProject={openProjectInEditor} />
        </div>
      )}

      {view === 'settings' && (
        <div className="flex-1 min-h-0">
          <SettingsPanel />
        </div>
      )}
    </div>
  );
}

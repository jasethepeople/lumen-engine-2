/**
 * OnboardingWizardView — guided first-run flow rendering the real
 * @lumen/app-onboarding step machine (OnboardingWizard) end to end:
 *
 *   welcome → choose-template → upload-hero-media → define-chapters
 *     → pick-theme → preview-motion → first-publish → done
 *
 * - Templates come from a TemplateProvider implemented over the marketplace
 *   TemplateCatalog (BuiltinSource) UNION the installed-templates store, so
 *   marketplace installs appear here immediately.
 * - Hero media files are read into bytes and held for the assets queue; on
 *   finish they are enqueued into the real AssetUploadQueue.
 * - Theme picker lists THEME_PRESETS from @lumen/app-settings with swatches.
 * - The motion step previews the assembled config (buildConfig) in the real
 *   PreviewPanel as the preference changes.
 * - Finish persists via createProjectFromWizard (real ProjectStore) and the
 *   App opens the created project in the editor.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '@lumen/app-projects';
import type { EngineConfig, TemplateKind } from '@lumen/contracts';
import {
  MAX_CHAPTERS,
  MIN_CHAPTERS,
  OnboardingWizard,
  buildConfig,
  createProjectFromWizard,
  type ChapterInput,
  type HeroMediaRef,
  type MotionPref,
  type TemplateProvider,
  type WizardState,
} from '@lumen/app-onboarding';
import { THEME_PRESETS } from '@lumen/app-settings';
import { listTemplates } from '@lumen/app-runtime';
import { ASSET_OPS } from '@lumen/app-assets';
import { assetQueue, getMarketplace, projectStore, telemetry } from '../platform/services';
import { PreviewPanel } from './PreviewPanel';

const MOTION_PREFS: { id: MotionPref; label: string; hint: string }[] = [
  { id: 'inherit', label: 'Inherit', hint: 'Use the template default motion.' },
  { id: 'continuous', label: 'Continuous', hint: 'Smooth scroll-driven motion.' },
  { id: 'reveal', label: 'Reveal', hint: 'Reduced, fade-in reveals.' },
  { id: 'static', label: 'Static', hint: 'No motion at all.' },
];

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

interface HeldMedia {
  ref: HeroMediaRef;
  bytes: Uint8Array;
}

/** TemplateProvider over the marketplace catalog + installed store. */
class CatalogTemplateProvider implements TemplateProvider {
  constructor(
    private readonly entries: readonly { id: string; name: string; kind: TemplateKind }[],
  ) {}
  list() {
    return this.entries.map((e) => ({ id: e.id, name: e.name, kind: e.kind }));
  }
}

export function OnboardingWizardView({
  onFinish,
  onSkip,
}: {
  /** Called with the created project once the wizard finishes. */
  onFinish(project: Project): void;
  /** 'Skip to editor'. */
  onSkip(): void;
}) {
  const [provider, setProvider] = useState<TemplateProvider | null>(null);
  const [wizard, setWizard] = useState<OnboardingWizard | null>(null);
  const [state, setState] = useState<WizardState | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [finishing, setFinishing] = useState(false);

  // Per-step local edit state.
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [chapters, setChapters] = useState<ChapterInput[]>([
    { id: 'chapter-1', title: 'Opening', duration: 1000 },
  ]);
  const [themeId, setThemeId] = useState<string>(THEME_PRESETS[0]?.id ?? '');
  const [motion, setMotion] = useState<MotionPref>('inherit');
  const [publishTarget, setPublishTarget] = useState('vercel-mock');
  const heldMedia = useRef<HeldMedia[]>([]);
  const [mediaNames, setMediaNames] = useState<string[]>([]);

  // Build the template provider from the marketplace catalog + installs.
  useEffect(() => {
    void (async () => {
      const marketplace = await getMarketplace();
      const runtime = listTemplates().map((t) => ({
        id: t.id,
        name: t.id,
        kind: t.kind,
      }));
      const installed = marketplace.installed
        .list()
        .map((r) => marketplace.templates.getById(r.templateId))
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .map((m) => ({ id: m.id, name: m.name, kind: m.templateKind }));
      const seen = new Set<string>();
      const entries = [...installed, ...runtime].filter((e) =>
        seen.has(e.id) ? false : (seen.add(e.id), true),
      );
      setProvider(new CatalogTemplateProvider(entries));
    })();
  }, []);

  // Create the wizard once the provider is ready.
  useEffect(() => {
    if (!provider || wizard) return;
    const w = new OnboardingWizard({ templateProvider: provider });
    w.start();
    setWizard(w);
    setState(w.state());
  }, [provider, wizard]);

  // Subscribe to wizard state changes.
  useEffect(() => {
    if (!wizard) return;
    return wizard.subscribe((s) => setState(s));
  }, [wizard]);

  const templates = useMemo(() => wizard?.listTemplates() ?? [], [wizard, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const content = wizard?.current();
  const checklist = wizard?.checklistStatus({ publishTarget });

  // Motion-step live preview: assemble the config with the current motion pick.
  const previewConfig: EngineConfig | null = useMemo(() => {
    if (!state || state.stepId !== 'preview-motion' || !provider) return null;
    try {
      return buildConfig(
        { ...state, answers: { ...state.answers, motionPref: motion } },
        { templateProvider: provider },
      );
    } catch {
      return null;
    }
  }, [state, motion, provider]);

  if (!wizard || !state || !content) {
    return (
      <div className="p-8 text-sm text-ink-400">Loading the onboarding wizard…</div>
    );
  }

  const applyAndNext = () => {
    setErrors([]);
    const stepId = state.stepId;
    const input =
      stepId === 'choose-template'
        ? { templateId: selectedTemplate }
        : stepId === 'upload-hero-media'
          ? { heroMedia: heldMedia.current.map((h) => h.ref) }
          : stepId === 'define-chapters'
            ? { chapters }
            : stepId === 'pick-theme'
              ? { themeId }
              : stepId === 'preview-motion'
                ? { motionPref: motion }
                : stepId === 'first-publish'
                  ? { publishTarget }
                  : undefined;
    const result = wizard.next(input);
    if (!result.ok) setErrors(result.errors);
  };

  const finish = async () => {
    setFinishing(true);
    setErrors([]);
    try {
      // Record the publish target and advance first-publish → done.
      const advanced = wizard.next({ publishTarget });
      if (!advanced.ok) {
        setErrors(advanced.errors);
        setFinishing(false);
        return;
      }
      const project = await createProjectFromWizard(projectStore, wizard, {
        templateProvider: provider ?? undefined,
        name: `${state.answers.templateId ?? 'lumen'}-project`,
      });
      telemetry.track('builder.project.created', {
        projectId: project.id,
        source: 'onboarding-wizard',
      });
      // Hero media bytes → real assets queue.
      for (const held of heldMedia.current) {
        assetQueue.enqueue({
          id: `wizard-${held.ref.name}`,
          kind: held.ref.kind,
          sourceName: held.ref.name,
          bytes: held.bytes,
          ops: ASSET_OPS,
        });
      }
      onFinish(project);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setFinishing(false);
    }
  };

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    void (async () => {
      for (const file of Array.from(files)) {
        const kind: HeroMediaRef['kind'] = VIDEO_EXT.test(file.name) ? 'video' : 'image';
        const bytes = new Uint8Array(await file.arrayBuffer());
        heldMedia.current = [...heldMedia.current, { ref: { name: file.name, kind }, bytes }];
      }
      setMediaNames(heldMedia.current.map((h) => h.ref.name));
    })();
  };

  const steps = wizard.steps();
  const isLast = state.stepId === 'first-publish';

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-5">
        {/* Progress */}
        <div className="flex items-center gap-1 flex-wrap">
          {steps.map((s, i) => (
            <button
              key={s.id}
              className={`px-2 py-1 rounded text-[10px] uppercase tracking-wider border ${
                i === state.stepIndex
                  ? 'border-accent/50 text-accent'
                  : i < state.stepIndex
                    ? 'border-ink-700 text-ink-300'
                    : 'border-ink-800 text-ink-500'
              }`}
              onClick={() => {
                const r = wizard.goTo(s.id);
                if (!r.ok) setErrors(r.errors);
                else setErrors([]);
              }}
            >
              {s.title}
            </button>
          ))}
          <button className="btn text-xs ml-auto" onClick={onSkip}>
            Skip to editor
          </button>
        </div>

        {/* Step header: title + tooltip + checklist from the package */}
        <div className="card">
          <h2 className="text-lg text-ink-100 font-semibold">{content.title}</h2>
          <p className="text-sm text-ink-300 mt-1">{content.tooltip}</p>
          <ul className="mt-3 space-y-1">
            {content.checklist.map((item) => (
              <li key={item} className="text-[11px] text-ink-400 flex gap-2">
                <span className="text-accent">•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {errors.length > 0 && (
          <div className="rounded border border-red-900 bg-ink-950 p-3">
            {errors.map((e) => (
              <div key={e} className="text-xs text-red-200 font-mono">
                {e}
              </div>
            ))}
          </div>
        )}

        {/* Step bodies */}
        {state.stepId === 'welcome' && (
          <div className="card text-sm text-ink-300">
            This wizard assembles a real EngineConfig from your answers and saves it as a
            project. Everything here runs through the same packages the CLI uses.
          </div>
        )}

        {state.stepId === 'choose-template' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {templates.map((t) => (
              <button
                key={t.id}
                className={`card text-left transition-colors ${
                  selectedTemplate === t.id ? 'border-accent/60' : 'hover:border-ink-600'
                }`}
                onClick={() => setSelectedTemplate(t.id)}
              >
                <div className="text-sm text-ink-100">{t.name}</div>
                <div className="text-[10px] font-mono text-ink-400 mt-1">
                  {t.id} · kind: {t.kind}
                </div>
              </button>
            ))}
            {templates.length === 0 && (
              <p className="text-sm text-ink-400">No templates available.</p>
            )}
          </div>
        )}

        {state.stepId === 'upload-hero-media' && (
          <div className="card space-y-3">
            <input
              type="file"
              multiple
              accept="video/*,image/*"
              onChange={(e) => onFiles(e.target.files)}
            />
            {mediaNames.length > 0 && (
              <ul className="space-y-1">
                {heldMedia.current.map((h) => (
                  <li key={h.ref.name} className="text-xs font-mono text-ink-300">
                    {h.ref.name} · {h.ref.kind} · {(h.bytes.length / 1024).toFixed(1)} KB
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-ink-400">
              Files stay local: bytes are held for the asset pipeline and enqueued when you
              finish the wizard.
            </p>
          </div>
        )}

        {state.stepId === 'define-chapters' && (
          <div className="card space-y-2">
            {chapters.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="w-32"
                  value={c.id}
                  placeholder="id"
                  onChange={(e) =>
                    setChapters(
                      chapters.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)),
                    )
                  }
                />
                <input
                  className="flex-1"
                  value={c.title}
                  placeholder="Chapter title"
                  onChange={(e) =>
                    setChapters(
                      chapters.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                    )
                  }
                />
                <input
                  className="w-24"
                  type="number"
                  value={c.duration ?? 1000}
                  onChange={(e) =>
                    setChapters(
                      chapters.map((x, j) =>
                        j === i ? { ...x, duration: Number(e.target.value) } : x,
                      ),
                    )
                  }
                />
                <button
                  className="btn-danger text-xs"
                  disabled={chapters.length <= MIN_CHAPTERS}
                  onClick={() => setChapters(chapters.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="btn text-xs"
              disabled={chapters.length >= MAX_CHAPTERS}
              onClick={() =>
                setChapters([
                  ...chapters,
                  {
                    id: `chapter-${chapters.length + 1}`,
                    title: `Chapter ${chapters.length + 1}`,
                    duration: 1000,
                  },
                ])
              }
            >
              Add chapter ({chapters.length}/{MAX_CHAPTERS})
            </button>
          </div>
        )}

        {state.stepId === 'pick-theme' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {THEME_PRESETS.map((p) => (
              <button
                key={p.id}
                className={`card text-left transition-colors ${
                  themeId === p.id ? 'border-accent/60' : 'hover:border-ink-600'
                }`}
                onClick={() => setThemeId(p.id)}
              >
                <div className="text-sm text-ink-100">{p.name}</div>
                <div className="flex gap-1.5 mt-2">
                  {[
                    p.tokens.background,
                    p.tokens.surface,
                    p.tokens.text,
                    p.tokens.accent,
                  ].map((color) => (
                    <span
                      key={color}
                      className="w-6 h-6 rounded border border-ink-700"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
                <div className="text-[10px] font-mono text-ink-400 mt-2">{p.id}</div>
              </button>
            ))}
          </div>
        )}

        {state.stepId === 'preview-motion' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {MOTION_PREFS.map((m) => (
                <button
                  key={m.id}
                  className={`card text-left transition-colors ${
                    motion === m.id ? 'border-accent/60' : 'hover:border-ink-600'
                  }`}
                  onClick={() => setMotion(m.id)}
                  title={m.hint}
                >
                  <div className="text-sm text-ink-100">{m.label}</div>
                  <div className="text-[10px] text-ink-400 mt-1">{m.hint}</div>
                </button>
              ))}
            </div>
            <div className="border border-ink-800 rounded-lg overflow-hidden h-80">
              {previewConfig ? (
                <PreviewPanel config={previewConfig} />
              ) : (
                <div className="h-full grid place-items-center text-sm text-ink-400">
                  Complete the earlier steps to preview motion.
                </div>
              )}
            </div>
          </div>
        )}

        {state.stepId === 'first-publish' && (
          <div className="card space-y-3">
            <div>
              <label className="field-label">Publish target</label>
              <select value={publishTarget} onChange={(e) => setPublishTarget(e.target.value)}>
                <option value="vercel-mock">vercel (mock) — local deployment</option>
              </select>
            </div>
            {checklist && (
              <ul className="space-y-1">
                {Object.entries(checklist).map(([item, done]) => (
                  <li key={item} className="text-xs flex items-center gap-2">
                    <span className={done ? 'text-emerald-300' : 'text-ink-500'}>
                      {done ? '✓' : '○'}
                    </span>
                    <span className={done ? 'text-ink-200' : 'text-ink-400'}>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {state.stepId === 'done' && (
          <div className="card text-sm text-emerald-200">
            Project saved. Opening it in the editor…
          </div>
        )}

        {/* Nav */}
        <div className="flex items-center gap-2 pb-6">
          <button
            className="btn text-xs"
            disabled={state.stepIndex === 0}
            onClick={() => {
              setErrors([]);
              wizard.back();
            }}
          >
            Back
          </button>
          {!isLast && state.stepId !== 'done' && (
            <button className="btn-primary text-xs" onClick={applyAndNext}>
              {content.optional ? 'Continue (optional step)' : 'Continue'}
            </button>
          )}
          {isLast && (
            <button className="btn-primary text-xs" disabled={finishing} onClick={() => void finish()}>
              {finishing ? 'Creating project…' : 'Finish — create project'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

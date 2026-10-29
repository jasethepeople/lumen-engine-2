/**
 * AIAssistantPanel — @lumen/app-ai wired UI:
 * - description → generateSceneIRFromDescription (HeuristicProvider) with a
 *   live PreviewPanel of the generated config + Use-as-new-project /
 *   Load-into-editor actions
 * - chapter / motion / camera suggestions on the current editor config with
 *   apply-into-config actions
 * - asset tagging over the real AssetLibrary (tagAsset + colorway groups)
 * - template recommendations from a description (recommendTemplates over the
 *   marketplace catalog)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EngineConfig } from '@lumen/contracts';
import {
  detectColorwayVariants,
  generateSceneIRFromDescription,
  recommendTemplates,
  suggestCameraTracks,
  suggestChapterStructure,
  suggestMotionProfiles,
  tagAsset,
  type CameraKeyframe,
  type CameraMove,
  type ChapterSuggestion,
  type MotionSuggestion,
  type TemplateRecommendation,
} from '@lumen/app-ai';
import type { Marketplace, TemplateMeta } from '@lumen/app-marketplace';
import type { Project } from '@lumen/app-projects';
import {
  aiProvider,
  assetLibrary,
  getMarketplace,
  projectStore,
  telemetry,
} from '../platform/services';
import { PreviewPanel } from './PreviewPanel';

const CAMERA_MOVES: CameraMove[] = ['push-in', 'pull-back', 'orbit', 'pan', 'settle'];

export interface AIAssistantPanelProps {
  config: EngineConfig | null;
  reducedMotion: boolean;
  onLoadIntoEditor(config: EngineConfig): void;
  onOpenProject(project: Project): void;
}

export function AIAssistantPanel({
  config,
  reducedMotion,
  onLoadIntoEditor,
  onOpenProject,
}: AIAssistantPanelProps) {
  // ---- Generation ---------------------------------------------------------
  const [description, setDescription] = useState('');
  const [generated, setGenerated] = useState<EngineConfig | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const generate = async () => {
    if (!description.trim()) return;
    setGenerating(true);
    setGenError(null);
    setNotice(null);
    try {
      const cfg = await generateSceneIRFromDescription(description, { provider: aiProvider });
      setGenerated(cfg);
      telemetry.track('builder.ai.generated', { length: description.length });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const useAsNewProject = async () => {
    if (!generated) return;
    const project = await projectStore.createProject({
      name: (generated.meta?.title as string | undefined) ?? 'AI-generated project',
      templateKind: generated.template,
      templateId: generated.template,
      config: generated,
    });
    onOpenProject(project);
  };

  // ---- Suggestions on the current config ----------------------------------
  const chapters = useMemo<ChapterSuggestion[]>(
    () => (config ? suggestChapterStructure(config) : []),
    [config],
  );
  const motionSuggestions = useMemo<MotionSuggestion[]>(
    () => (config ? suggestMotionProfiles(config) : []),
    [config],
  );
  const [cameraMove, setCameraMove] = useState<CameraMove>('push-in');
  const [cameraSceneId, setCameraSceneId] = useState('');
  const [cameraKeys, setCameraKeys] = useState<CameraKeyframe[]>([]);

  const runCameraSuggest = () => {
    if (!config || !cameraSceneId) return;
    const scene = config.scenes.find((s) => s.id === cameraSceneId);
    setCameraKeys(suggestCameraTracks(scene ? { id: scene.id, track: scene.track } : cameraSceneId, cameraMove));
  };

  /**
   * Chapters have no dedicated field in the EngineConfig DSL, so the apply
   * maps each suggested chapter onto the a11y label/summary of the first
   * scene in its (evenly divided) group — real, validated config fields.
   */
  const applyChapters = () => {
    if (!config || chapters.length === 0) return;
    const next: EngineConfig = JSON.parse(JSON.stringify(config));
    const per = Math.max(1, Math.ceil(next.scenes.length / chapters.length));
    chapters.forEach((c, i) => {
      const scene = next.scenes[i * per];
      if (!scene) return;
      scene.a11y = { ...scene.a11y, label: c.title, summary: c.rationale };
    });
    onLoadIntoEditor(next);
    setNotice(`Applied ${chapters.length} suggested chapters to scene a11y labels.`);
  };

  /** MotionMode lives on SceneConfig.a11y.motion in the config DSL. */
  const applyMotion = (s: MotionSuggestion) => {
    if (!config) return;
    const next: EngineConfig = JSON.parse(JSON.stringify(config));
    const scene = next.scenes.find((sc) => sc.id === s.sceneId);
    if (!scene) return;
    scene.a11y = { ...scene.a11y, motion: s.suggested.motion };
    onLoadIntoEditor(next);
    setNotice(`Applied motion "${s.suggested.motion}" to scene "${s.sceneId}".`);
  };

  /**
   * Camera keyframes are stored on the scene's camera node meta (a
   * Record<string, unknown> config field), creating the node if absent.
   */
  const applyCamera = () => {
    if (!config || !cameraSceneId || cameraKeys.length === 0) return;
    const next: EngineConfig = JSON.parse(JSON.stringify(config));
    const scene = next.scenes.find((sc) => sc.id === cameraSceneId);
    if (!scene) return;
    let camera = scene.nodes.find((n) => n.kind === 'camera');
    if (!camera) {
      camera = { id: `${scene.id}-camera`, kind: 'camera' };
      scene.nodes.push(camera);
    }
    camera.meta = { ...camera.meta, cameraMove, keyframes: cameraKeys };
    onLoadIntoEditor(next);
    setNotice(`Stored ${cameraKeys.length} camera keyframes on "${camera.id}".`);
  };

  // ---- Asset tagging --------------------------------------------------------
  const assets = assetLibrary.list();
  const [selectedAsset, setSelectedAsset] = useState('');
  const selected = assets.find((a) => a.assetId === selectedAsset);
  const tags = selected ? tagAsset({ name: selected.name }) : null;
  const colorways = detectColorwayVariants(assets.map((a) => a.name));

  // ---- Template recommendations ---------------------------------------------
  const [recQuery, setRecQuery] = useState('');
  const [recs, setRecs] = useState<TemplateRecommendation[]>([]);
  const [recMeta, setRecMeta] = useState<Record<string, TemplateMeta>>({});
  const [marketplace, setMarketplace] = useState<Marketplace | null>(null);

  useEffect(() => {
    void getMarketplace().then(setMarketplace);
  }, []);

  const recommend = useCallback(() => {
    if (!marketplace || !recQuery.trim()) return;
    const catalog = marketplace.templates.list();
    const found = recommendTemplates(recQuery, catalog);
    setRecs(found);
    setRecMeta(Object.fromEntries(catalog.map((t) => [t.id, t])));
  }, [marketplace, recQuery]);

  return (
    <div className="h-full overflow-y-auto p-5 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="section-title mb-0">AI Assistant</h2>
        <span className="text-[10px] font-mono text-ink-400">
          provider: {aiProvider.name} (deterministic, offline)
        </span>
      </div>

      {notice && (
        <div className="rounded border border-emerald-900 bg-ink-950 p-3 text-xs text-emerald-200">
          {notice}
        </div>
      )}

      {/* Generate */}
      <section className="card space-y-3">
        <h3 className="text-sm text-ink-100 font-semibold">Generate a scene from a description</h3>
        <textarea
          className="w-full h-24"
          placeholder="A moody product launch for a ceramic studio, three chapters, slow cinematic camera…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <button
            className="btn-primary text-xs disabled:opacity-40"
            disabled={generating || !description.trim()}
            onClick={() => void generate()}
          >
            {generating ? 'Generating…' : 'Generate config'}
          </button>
          {generated && (
            <>
              <button className="btn text-xs" onClick={() => void useAsNewProject()}>
                Use as new project
              </button>
              <button className="btn text-xs" onClick={() => onLoadIntoEditor(generated)}>
                Load into editor
              </button>
            </>
          )}
        </div>
        {genError && (
          <div className="rounded border border-red-900 bg-ink-950 p-3 text-xs text-red-200">
            {genError}
          </div>
        )}
        {generated && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="h-64 rounded border border-ink-800 overflow-hidden">
              <PreviewPanel config={generated} reducedMotion={reducedMotion} />
            </div>
            <pre className="h-64 overflow-auto rounded border border-ink-800 bg-ink-950 p-3 text-[10px] font-mono text-ink-300">
              {JSON.stringify(generated, null, 2)}
            </pre>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Chapter suggestions */}
        <section className="card space-y-2">
          <h3 className="text-sm text-ink-100 font-semibold">Chapter structure</h3>
          {!config && <p className="text-xs text-ink-500">Fix the editor config to get suggestions.</p>}
          <ul className="space-y-1.5">
            {chapters.map((c) => (
              <li key={c.id} className="text-xs">
                <span className="text-ink-100">{c.title}</span>
                <span className="text-ink-500 font-mono"> · ~{c.estimatedDuration}s</span>
                <div className="text-ink-400">{c.rationale}</div>
              </li>
            ))}
          </ul>
          {chapters.length > 0 && (
            <button className="btn-primary text-xs" onClick={applyChapters}>
              Apply chapters to config
            </button>
          )}
        </section>

        {/* Motion suggestions */}
        <section className="card space-y-2">
          <h3 className="text-sm text-ink-100 font-semibold">Motion profiles</h3>
          <ul className="space-y-1.5">
            {motionSuggestions.map((s) => (
              <li key={s.sceneId} className="text-xs flex items-start gap-2">
                <div className="flex-1">
                  <span className="font-mono text-accent">{s.sceneId}</span>
                  <span className="text-ink-300"> → {s.suggested.motion}</span>
                  <div className="text-ink-400">{s.rationale}</div>
                </div>
                <button className="btn text-xs shrink-0" onClick={() => applyMotion(s)}>
                  Apply
                </button>
              </li>
            ))}
          </ul>
          {config && motionSuggestions.length === 0 && (
            <p className="text-xs text-ink-500">No motion changes suggested for this config.</p>
          )}
        </section>

        {/* Camera tracks */}
        <section className="card space-y-2">
          <h3 className="text-sm text-ink-100 font-semibold">Camera tracks</h3>
          <div className="flex gap-2 flex-wrap">
            <select value={cameraSceneId} onChange={(e) => setCameraSceneId(e.target.value)}>
              <option value="">scene…</option>
              {config?.scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                </option>
              ))}
            </select>
            <select value={cameraMove} onChange={(e) => setCameraMove(e.target.value as CameraMove)}>
              {CAMERA_MOVES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              className="btn text-xs disabled:opacity-40"
              disabled={!cameraSceneId}
              onClick={runCameraSuggest}
            >
              Suggest
            </button>
          </div>
          {cameraKeys.length > 0 && (
            <>
              <pre className="max-h-32 overflow-auto rounded border border-ink-800 bg-ink-950 p-2 text-[10px] font-mono text-ink-300">
                {JSON.stringify(cameraKeys, null, 2)}
              </pre>
              <button className="btn-primary text-xs" onClick={applyCamera}>
                Append keyframes to scene
              </button>
            </>
          )}
        </section>

        {/* Asset tagging */}
        <section className="card space-y-2">
          <h3 className="text-sm text-ink-100 font-semibold">Asset tagging</h3>
          {assets.length === 0 && (
            <p className="text-xs text-ink-500">
              No processed assets yet — upload some in the Assets tab.
            </p>
          )}
          <select value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value)}>
            <option value="">pick an asset…</option>
            {assets.map((a) => (
              <option key={a.assetId} value={a.assetId}>
                {a.name}
              </option>
            ))}
          </select>
          {tags && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-ink-400">media kind</dt>
              <dd className="font-mono text-ink-200">{tags.mediaKind}</dd>
              <dt className="text-ink-400">hero candidate</dt>
              <dd className="font-mono text-ink-200">{String(tags.isHeroCandidate)}</dd>
              <dt className="text-ink-400">colorway</dt>
              <dd className="font-mono text-ink-200">{tags.colorway ?? '—'}</dd>
            </dl>
          )}
          {colorways.length > 0 && (
            <div>
              <span className="field-label">Colorway groups</span>
              <ul className="space-y-1">
                {colorways.map((g) => (
                  <li key={g.stem} className="text-xs font-mono text-ink-300">
                    {g.stem}: {g.variants.join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* Template recommendations */}
      <section className="card space-y-2">
        <h3 className="text-sm text-ink-100 font-semibold">Template recommendations</h3>
        <div className="flex gap-2">
          <input
            className="flex-1"
            placeholder="Describe what you are building…"
            value={recQuery}
            onChange={(e) => setRecQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && recommend()}
          />
          <button
            className="btn-primary text-xs disabled:opacity-40"
            disabled={!marketplace || !recQuery.trim()}
            onClick={recommend}
          >
            Recommend
          </button>
        </div>
        <ul className="space-y-1.5">
          {recs.map((r) => (
            <li key={r.id} className="text-xs flex items-center gap-2">
              <span className="font-mono text-accent">{recMeta[r.id]?.name ?? r.id}</span>
              <span className="text-ink-500 font-mono">score {r.score.toFixed(2)}</span>
              <span className="text-ink-400">{r.rationale}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * MotionDesignerPanel — @lumen/app-designer UI:
 * per-scene keyframe lane editors (add/move/remove keyframes, easing picker
 * from EASING_LIBRARY, segment editing), camera track lanes, undo/redo, a
 * scrub bar with frame-step buttons (ScrubController evaluated values), a
 * motion-graph SVG visualization with a reduced-motion overlay toggle, and
 * Save → timelineToConfig written back into the editor config.
 */

import { useMemo, useRef, useState } from 'react';
import type { EngineConfig, SceneConfig, TimelineTrack } from '@lumen/contracts';
import {
  EASING_LIBRARY,
  ScrubController,
  TimelineEditor,
  buildMotionGraph,
  createCameraTrackLanes,
  createTimelineDocument,
  getEasingPreset,
  reducedMotionOverlay,
  timelineDocToTrack,
  timelineToConfig,
  type MotionGraphNode,
  type TimelineKeyframe,
} from '@lumen/app-designer';

const FPS = 30;

interface EditorSet {
  main: TimelineEditor;
  camera: { position: TimelineEditor; zoom: TimelineEditor } | null;
}

function docForScene(scene: SceneConfig): TimelineEditor {
  const track: TimelineTrack = {
    id: `track-${scene.id}`,
    target: scene.nodes[0]?.id ?? scene.id,
    keyframes: [],
    driver: scene.track.driver,
    range: [0, scene.track.durationOrRange],
    motion: scene.a11y.motion,
  };
  return new TimelineEditor(
    createTimelineDocument({
      id: track.id,
      sceneId: scene.id,
      target: track.target,
      driver: track.driver,
      range: track.range,
      keyframes: [],
      motion: track.motion,
    }),
  );
}

function cameraEditorsFor(scene: SceneConfig): EditorSet['camera'] {
  const camera = scene.nodes.find((n) => n.kind === 'camera');
  if (!camera) return null;
  const lanes = createCameraTrackLanes(camera.id, {
    sceneId: scene.id,
    driver: scene.track.driver,
    range: [0, scene.track.durationOrRange],
  });
  return {
    position: new TimelineEditor(lanes.position),
    zoom: new TimelineEditor(lanes.zoom),
  };
}

export interface MotionDesignerPanelProps {
  config: EngineConfig | null;
  onSave(next: EngineConfig): void;
}

export function MotionDesignerPanel({ config, onSave }: MotionDesignerPanelProps) {
  const scenes = useMemo(() => config?.scenes ?? [], [config]);
  const [sceneId, setSceneId] = useState('');
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0];

  // TimelineEditor instances persist per scene across renders.
  const editorsRef = useRef(new Map<string, EditorSet>());
  const [, bump] = useState(0);
  const rerender = () => bump((v) => v + 1);

  const editors = useMemo(() => {
    if (!scene) return null;
    let set = editorsRef.current.get(scene.id);
    if (!set) {
      set = { main: docForScene(scene), camera: cameraEditorsFor(scene) };
      editorsRef.current.set(scene.id, set);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id]);

  const [scrubT, setScrubT] = useState(0);
  const [overlayOn, setOverlayOn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const tracks: TimelineTrack[] = useMemo(() => {
    if (!editors) return [];
    const list = [timelineDocToTrack(editors.main.doc)];
    if (editors.camera) {
      list.push(timelineDocToTrack(editors.camera.position.doc));
      list.push(timelineDocToTrack(editors.camera.zoom.doc));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editors, editors?.main.doc, editors?.camera]);

  const scrubber = useMemo(() => new ScrubController(tracks), [tracks]);
  const sample = scrubber.seek(scrubT);

  const graph = useMemo(() => (config ? buildMotionGraph(config) : null), [config]);
  const annotated = useMemo(
    () => (graph && overlayOn ? reducedMotionOverlay(graph, { reducedMotion: true }) : null),
    [graph, overlayOn],
  );

  if (!config || !scene || !editors) {
    return (
      <div className="h-full grid place-items-center p-8">
        <p className="text-sm text-ink-400">A valid config with scenes is required.</p>
      </div>
    );
  }

  const range = editors.main.doc.range;

  const save = () => {
    const out = timelineToConfig(editors.main.doc, { nodes: scene.nodes });
    const next: EngineConfig = JSON.parse(JSON.stringify(config));
    const target = next.scenes.find((s) => s.id === scene.id);
    if (!target) return;
    target.slot = out.scene.slot;
    target.track = { ...out.scene.track };
    if (editors.main.doc.motion) target.a11y = { ...target.a11y, motion: editors.main.doc.motion };
    onSave(next);
    setNotice(
      `Saved timeline to "${scene.id}": driver=${out.scene.track.driver}, range=${out.scene.track.durationOrRange}, ${editors.main.doc.keyframes.length} keyframes.`,
    );
  };

  const lane = (
    editor: TimelineEditor,
    label: string,
  ) => (
    <div className="rounded border border-ink-800 p-3 space-y-2" key={label}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-100 font-semibold">{label}</span>
        <span className="text-[10px] font-mono text-ink-500">
          {editor.doc.id} → {editor.doc.target} · [{editor.doc.range[0]}, {editor.doc.range[1]}]
        </span>
        <div className="ml-auto flex gap-1">
          <button
            className="btn text-xs disabled:opacity-40"
            disabled={editor.undo.undoDepth === 0}
            onClick={() => {
              editor.undoOnce();
              rerender();
            }}
          >
            Undo
          </button>
          <button
            className="btn text-xs disabled:opacity-40"
            disabled={editor.undo.redoDepth === 0}
            onClick={() => {
              editor.redoOnce();
              rerender();
            }}
          >
            Redo
          </button>
        </div>
      </div>

      {/* keyframe lane */}
      <div className="relative h-8 rounded bg-ink-950 border border-ink-800">
        {editor.doc.keyframes.map((k: TimelineKeyframe) => {
          const [from, to] = editor.doc.range;
          const pct = to > from ? ((k.t - from) / (to - from)) * 100 : 0;
          return (
            <span
              key={k.id}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-accent rounded-[2px]"
              style={{ left: `${Math.min(100, Math.max(0, pct))}%` }}
              title={`t=${k.t} value=${JSON.stringify(k.value)}${k.easing ? ` easing=${k.easing}` : ''}`}
            />
          );
        })}
      </div>

      <ul className="space-y-1">
        {editor.doc.keyframes.map((k) => (
          <li key={k.id} className="flex items-center gap-2 text-xs">
            <span className="font-mono text-ink-500 w-20 truncate">{k.id}</span>
            <label className="flex items-center gap-1">
              <span className="text-ink-400">t</span>
              <input
                type="number"
                className="w-20"
                value={k.t}
                step={0.1}
                onChange={(e) => {
                  editor.moveKeyframe(k.id, Number(e.target.value));
                  rerender();
                }}
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-ink-400">value</span>
              <input
                type="number"
                className="w-20"
                value={typeof k.value === 'number' ? k.value : 0}
                step={0.1}
                onChange={(e) => {
                  editor.moveKeyframe(k.id, k.t, Number(e.target.value));
                  rerender();
                }}
              />
            </label>
            <select
              value={
                EASING_LIBRARY.find((p) => p.easing === k.easing)?.id ??
                (k.easingBezier ? 'custom-bezier' : 'linear')
              }
              onChange={(e) => {
                const preset = getEasingPreset(e.target.value);
                editor.setEasing(k.id, preset ? preset.easing : undefined);
                rerender();
              }}
            >
              {EASING_LIBRARY.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              className="btn text-xs"
              onClick={() => {
                editor.removeKeyframe(k.id);
                rerender();
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        className="btn text-xs"
        onClick={() => {
          const [from, to] = editor.doc.range;
          editor.addKeyframe({ t: (from + to) / 2, value: 0 });
          rerender();
        }}
      >
        + Keyframe at midpoint
      </button>

      {/* segments */}
      {editor.doc.segments.length > 0 && (
        <ul className="space-y-1">
          {editor.doc.segments.map((seg) => (
            <li key={seg.id} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-ink-500 w-20 truncate">{seg.id}</span>
              <label className="flex items-center gap-1">
                <span className="text-ink-400">from</span>
                <input
                  type="number"
                  className="w-20"
                  value={seg.from}
                  onChange={(e) => {
                    editor.moveSegment(seg.id, Number(e.target.value), seg.to);
                    rerender();
                  }}
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-ink-400">to</span>
                <input
                  type="number"
                  className="w-20"
                  value={seg.to}
                  onChange={(e) => {
                    editor.moveSegment(seg.id, seg.from, Number(e.target.value));
                    rerender();
                  }}
                />
              </label>
              <button
                className="btn text-xs"
                onClick={() => {
                  editor.removeSegment(seg.id);
                  rerender();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="btn text-xs"
        onClick={() => {
          const [from, to] = editor.doc.range;
          editor.addSegment({
            id: `seg-${editor.doc.segments.length + 1}`,
            from,
            to: (from + to) / 2,
            keys: [{ t: 0, value: 0 }, { t: 1, value: 1 }],
          });
          rerender();
        }}
      >
        + Segment
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto p-5 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="section-title mb-0">Motion Designer</h2>
        <select value={scene.id} onChange={(e) => setSceneId(e.target.value)}>
          {scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
        <button className="btn-primary text-xs" onClick={save}>
          Save to editor config
        </button>
        {notice && <span className="text-[10px] font-mono text-emerald-300">{notice}</span>}
      </div>

      {/* Scrub bar */}
      <section className="card space-y-2">
        <div className="flex items-center gap-2">
          <span className="field-label mb-0">Scrub</span>
          <input
            type="range"
            className="flex-1"
            min={range[0]}
            max={range[1]}
            step={1 / FPS}
            value={scrubT}
            onChange={(e) => setScrubT(Number(e.target.value))}
          />
          <button className="btn text-xs" onClick={() => setScrubT(scrubber.stepFrames(-1, FPS).t)}>
            ◀ frame
          </button>
          <button className="btn text-xs" onClick={() => setScrubT(scrubber.stepFrames(1, FPS).t)}>
            frame ▶
          </button>
          <span className="text-[10px] font-mono text-ink-400 w-24 text-right">
            t={sample.t.toFixed(3)}
          </span>
        </div>
        <div className="flex gap-4 flex-wrap">
          {Object.entries(sample.values).map(([trackId, value]) => (
            <span key={trackId} className="text-[10px] font-mono text-ink-300">
              {trackId}: <span className="text-accent">{JSON.stringify(value) ?? '—'}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Lanes */}
      <section className="space-y-3">
        {lane(editors.main, `Scene lane — ${scene.id}`)}
        {editors.camera && (
          <>
            <h3 className="text-sm text-ink-100 font-semibold">Camera track lanes</h3>
            {lane(editors.camera.position, 'camera.position')}
            {lane(editors.camera.zoom, 'camera.zoom')}
          </>
        )}
      </section>

      {/* Motion graph */}
      {graph && (
        <section className="card space-y-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm text-ink-100 font-semibold">Motion graph</h3>
            <label className="flex items-center gap-1.5 text-xs text-ink-300">
              <input
                type="checkbox"
                checked={overlayOn}
                onChange={(e) => setOverlayOn(e.target.checked)}
              />
              reduced-motion overlay
            </label>
            <span className="text-[10px] font-mono text-ink-500">
              {graph.nodes.length} nodes · {graph.edges.length} edges
            </span>
          </div>
          <MotionGraphSvg
            nodes={annotated?.nodes ?? graph.nodes}
            edges={
              annotated
                ? annotated.edges.map((e) => ({
                    id: e.id,
                    from: e.from,
                    to: e.to,
                    kind: e.kind,
                    fallback: e.reducedMotion.behavior !== 'full',
                    behavior: e.reducedMotion.behavior,
                  }))
                : graph.edges.map((e) => ({
                    id: e.id,
                    from: e.from,
                    to: e.to,
                    kind: e.kind,
                    fallback: false,
                    behavior: undefined,
                  }))
            }
          />
        </section>
      )}
    </div>
  );
}

/** Deterministic column-by-kind SVG layout for the motion graph. */
function MotionGraphSvg({
  nodes,
  edges,
}: {
  nodes: MotionGraphNode[];
  edges: {
    id: string;
    from: string;
    to: string;
    kind: string;
    fallback: boolean;
    behavior?: string;
  }[];
}) {
  const kinds = ['scene', 'driver', 'track', 'node'];
  const pos = new Map<string, { x: number; y: number }>();
  const perColumn = new Map<string, number>();
  for (const n of nodes) {
    const col = Math.max(0, kinds.indexOf(n.kind));
    const row = perColumn.get(n.kind) ?? 0;
    perColumn.set(n.kind, row + 1);
    pos.set(n.id, { x: 40 + col * 180, y: 30 + row * 46 });
  }
  const height = Math.max(120, ...[...pos.values()].map((p) => p.y + 40));
  return (
    <svg viewBox={`0 0 760 ${height}`} className="w-full rounded border border-ink-800 bg-ink-950">
      {edges.map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        return (
          <g key={e.id}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={e.fallback ? '#f59e0b' : '#57534e'}
              strokeWidth={e.fallback ? 2 : 1}
              strokeDasharray={e.fallback ? '4 3' : undefined}
            />
            <text
              x={(a.x + b.x) / 2}
              y={(a.y + b.y) / 2 - 3}
              fontSize={8}
              fill={e.fallback ? '#fbbf24' : '#78716c'}
              textAnchor="middle"
            >
              {e.kind}
              {e.fallback ? ` (${e.behavior})` : ''}
            </text>
          </g>
        );
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id)!;
        return (
          <g key={n.id}>
            <rect
              x={p.x - 52}
              y={p.y - 11}
              width={104}
              height={22}
              rx={4}
              fill="#1c1917"
              stroke="#44403c"
            />
            <text x={p.x} y={p.y + 3} fontSize={9} fill="#e7e5e4" textAnchor="middle">
              {n.id.length > 16 ? `${n.id.slice(0, 15)}…` : n.id}
            </text>
            <text x={p.x} y={p.y + 20} fontSize={7} fill="#78716c" textAnchor="middle">
              {n.kind}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

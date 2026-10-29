/**
 * Form-driven editors for the EngineConfig DSL: meta, theme tokens, scenes
 * (+ per-scene nodes), assets, interactions. All edits go through
 * ConfigState.update(), i.e. through @lumen/config validation.
 */

import type {
  EngineConfig,
  InteractionConfig,
  SceneConfig,
  SceneNodeConfig,
} from '@lumen/contracts';

type Update = (mutate: (cfg: EngineConfig) => void) => void;

const NODE_KINDS: SceneNodeConfig['kind'][] = [
  'dom',
  'mesh',
  'video-plane',
  'sprite',
  'group',
  'camera',
  'light',
];
const DRIVERS: SceneConfig['track']['driver'][] = ['scroll', 'time', 'pointer', 'playback'];
const ASSET_KINDS = ['image', 'video', 'model', 'font', 'lottie', 'audio'] as const;
const PRELOADS = ['critical', 'eager', 'lazy'] as const;
const SOURCES = ['scroll', 'pointer', 'touch', 'keyboard', 'deviceorientation'] as const;
const MOTION_MODES = ['continuous', 'reveal', 'static'] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/* ------------------------------------------------------------------ meta */

export function MetaEditor({ config, update }: { config: EngineConfig; update: Update }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Row label="Title">
        <input
          className="w-full"
          value={config.meta.title}
          onChange={(e) => update((c) => void (c.meta.title = e.target.value))}
        />
      </Row>
      <Row label="Locale">
        <input
          className="w-full"
          value={config.meta.locale}
          onChange={(e) => update((c) => void (c.meta.locale = e.target.value))}
        />
      </Row>
      <div className="col-span-2">
        <Row label="Description">
          <textarea
            className="w-full h-16"
            value={config.meta.description}
            onChange={(e) => update((c) => void (c.meta.description = e.target.value))}
          />
        </Row>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- theme */

export function ThemeEditor({ config, update }: { config: EngineConfig; update: Update }) {
  const colors = config.theme.colors ?? {};
  const typeScale = config.theme.typeScale ?? {};
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="field-label mb-0">Colors</span>
          <button
            className="btn"
            onClick={() =>
              update((c) => {
                c.theme.colors = { ...(c.theme.colors ?? {}), [`token-${Object.keys(colors).length + 1}`]: '#8ab4ff' };
              })
            }
          >
            + color
          </button>
        </div>
        <div className="space-y-2">
          {Object.entries(colors).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <input
                className="w-32 font-mono text-xs"
                value={key}
                onChange={(e) =>
                  update((c) => {
                    const next = { ...(c.theme.colors ?? {}) };
                    delete next[key];
                    next[e.target.value] = value;
                    c.theme.colors = next;
                  })
                }
              />
              <input
                type="color"
                className="w-8 h-8 p-0 border-ink-700"
                value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#888888'}
                onChange={(e) =>
                  update((c) => void ((c.theme.colors ??= {})[key] = e.target.value))
                }
              />
              <input
                className="flex-1 font-mono text-xs"
                value={value}
                onChange={(e) =>
                  update((c) => void ((c.theme.colors ??= {})[key] = e.target.value))
                }
              />
              <button
                className="btn-danger"
                onClick={() =>
                  update((c) => {
                    const next = { ...(c.theme.colors ?? {}) };
                    delete next[key];
                    c.theme.colors = next;
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="field-label mb-0">Type scale</span>
          <button
            className="btn"
            onClick={() =>
              update((c) => {
                c.theme.typeScale = {
                  ...(c.theme.typeScale ?? {}),
                  [`step-${Object.keys(typeScale).length + 1}`]: { size: '1rem', lineHeight: 1.5, weight: 400 },
                };
              })
            }
          >
            + step
          </button>
        </div>
        <div className="space-y-2">
          {Object.entries(typeScale).map(([key, step]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-24 font-mono text-xs text-ink-300 truncate">{key}</span>
              <input
                className="w-20 font-mono text-xs"
                title="size"
                value={step.size}
                onChange={(e) =>
                  update((c) => void ((c.theme.typeScale ??= {})[key] = { ...step, size: e.target.value }))
                }
              />
              <input
                className="w-16 font-mono text-xs"
                title="line-height"
                type="number"
                step="0.05"
                value={step.lineHeight}
                onChange={(e) =>
                  update((c) => void ((c.theme.typeScale ??= {})[key] = { ...step, lineHeight: Number(e.target.value) }))
                }
              />
              <input
                className="w-16 font-mono text-xs"
                title="weight"
                type="number"
                step="100"
                value={step.weight}
                onChange={(e) =>
                  update((c) => void ((c.theme.typeScale ??= {})[key] = { ...step, weight: Number(e.target.value) }))
                }
              />
              <button
                className="btn-danger"
                onClick={() =>
                  update((c) => {
                    const next = { ...(c.theme.typeScale ?? {}) };
                    delete next[key];
                    c.theme.typeScale = next;
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- scenes */

function newNode(n: number): SceneNodeConfig {
  return { id: `node-${n}`, kind: 'dom', html: '<p>New block</p>' };
}

function NodeEditor({
  scene,
  index,
  update,
}: {
  scene: SceneConfig;
  index: number;
  update: Update;
}) {
  return (
    <div className="space-y-2">
      {scene.nodes.map((node, ni) => (
        <div key={ni} className="border border-ink-800 rounded p-2 space-y-2 bg-ink-900/40">
          <div className="flex items-center gap-2">
            <input
              className="w-28 font-mono text-xs"
              value={node.id}
              onChange={(e) =>
                update((c) => void (c.scenes[index].nodes[ni].id = e.target.value))
              }
            />
            <select
              value={node.kind}
              onChange={(e) =>
                update(
                  (c) =>
                    void (c.scenes[index].nodes[ni].kind = e.target
                      .value as SceneNodeConfig['kind']),
                )
              }
            >
              {NODE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {(node.kind === 'mesh' || node.kind === 'video-plane' || node.kind === 'sprite') && (
              <input
                className="flex-1 font-mono text-xs"
                placeholder="assetId"
                value={node.assetId ?? ''}
                onChange={(e) =>
                  update((c) => void (c.scenes[index].nodes[ni].assetId = e.target.value || undefined))
                }
              />
            )}
            <button
              className="btn-danger ml-auto"
              onClick={() => update((c) => void c.scenes[index].nodes.splice(ni, 1))}
            >
              ×
            </button>
          </div>
          {node.kind === 'dom' && (
            <textarea
              className="w-full h-14 font-mono text-xs"
              placeholder="<h1>HTML content</h1>"
              value={node.html ?? ''}
              onChange={(e) =>
                update((c) => void (c.scenes[index].nodes[ni].html = e.target.value))
              }
            />
          )}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-ink-400">meta</span>
            <input
              className="w-28 font-mono text-xs"
              type="number"
              step="0.5"
              placeholder="scrollRange"
              value={(node.meta?.scrollRange as number | undefined) ?? ''}
              onChange={(e) =>
                update((c) => {
                  const n = c.scenes[index].nodes[ni];
                  const meta = { ...(n.meta ?? {}) };
                  if (e.target.value === '') delete meta.scrollRange;
                  else meta.scrollRange = Number(e.target.value);
                  n.meta = Object.keys(meta).length ? meta : undefined;
                })
              }
            />
            <input
              className="w-28 font-mono text-xs"
              type="number"
              step="0.5"
              placeholder="durationHint"
              value={(node.meta?.durationHint as number | undefined) ?? ''}
              onChange={(e) =>
                update((c) => {
                  const n = c.scenes[index].nodes[ni];
                  const meta = { ...(n.meta ?? {}) };
                  if (e.target.value === '') delete meta.durationHint;
                  else meta.durationHint = Number(e.target.value);
                  n.meta = Object.keys(meta).length ? meta : undefined;
                })
              }
            />
          </div>
        </div>
      ))}
      <button
        className="btn w-full"
        onClick={() => update((c) => void c.scenes[index].nodes.push(newNode(scene.nodes.length + 1)))}
      >
        + node
      </button>
    </div>
  );
}

export function ScenesEditor({ config, update }: { config: EngineConfig; update: Update }) {
  const move = (i: number, dir: -1 | 1) =>
    update((c) => {
      const j = i + dir;
      if (j < 0 || j >= c.scenes.length) return;
      const [s] = c.scenes.splice(i, 1);
      c.scenes.splice(j, 0, s);
    });

  return (
    <div className="space-y-3">
      {config.scenes.map((scene, i) => (
        <div key={i} className="border border-ink-800 rounded-lg p-3 space-y-3 bg-ink-850">
          <div className="flex items-center gap-2">
            <input
              className="w-28 font-mono text-xs"
              value={scene.id}
              onChange={(e) => update((c) => void (c.scenes[i].id = e.target.value))}
            />
            <input
              className="w-24 font-mono text-xs"
              title="slot"
              value={scene.slot}
              onChange={(e) => update((c) => void (c.scenes[i].slot = e.target.value))}
            />
            <select
              value={scene.track.driver}
              onChange={(e) =>
                update(
                  (c) =>
                    void (c.scenes[i].track.driver = e.target
                      .value as SceneConfig['track']['driver']),
                )
              }
            >
              {DRIVERS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input
              className="w-20 font-mono text-xs"
              type="number"
              step="0.5"
              title="durationOrRange"
              value={scene.track.durationOrRange}
              onChange={(e) =>
                update((c) => void (c.scenes[i].track.durationOrRange = Number(e.target.value)))
              }
            />
            <div className="ml-auto flex gap-1">
              <button className="btn" title="move up" onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="btn" title="move down" onClick={() => move(i, 1)}>
                ↓
              </button>
              <button
                className="btn-danger"
                onClick={() => update((c) => void c.scenes.splice(i, 1))}
              >
                ×
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 text-xs"
              placeholder="a11y label"
              value={scene.a11y.label}
              onChange={(e) => update((c) => void (c.scenes[i].a11y.label = e.target.value))}
            />
            <select
              title="a11y motion mode"
              value={scene.a11y.motion ?? ''}
              onChange={(e) =>
                update((c) => {
                  const v = e.target.value;
                  c.scenes[i].a11y.motion =
                    v === '' ? undefined : (v as (typeof MOTION_MODES)[number]);
                })
              }
            >
              <option value="">motion: inherit</option>
              {MOTION_MODES.map((m) => (
                <option key={m} value={m}>
                  motion: {m}
                </option>
              ))}
            </select>
          </div>
          <NodeEditor scene={scene} index={i} update={update} />
        </div>
      ))}
      <button
        className="btn w-full"
        onClick={() =>
          update((c) =>
            void c.scenes.push({
              id: `scene-${c.scenes.length + 1}`,
              slot: 'stage',
              nodes: [newNode(1)],
              track: { driver: 'scroll', durationOrRange: 4 },
              a11y: { label: 'New scene' },
            }),
          )
        }
      >
        + scene
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- assets */

export function AssetsEditor({ config, update }: { config: EngineConfig; update: Update }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_5rem_2fr_5.5rem_4rem_1.5rem] gap-2 text-[10px] uppercase tracking-wider text-ink-400">
        <span>id</span>
        <span>kind</span>
        <span>src</span>
        <span>priority</span>
        <span>dur (s)</span>
        <span />
      </div>
      {config.assets.map((a, i) => (
        <div key={i} className="grid grid-cols-[1fr_5rem_2fr_5.5rem_4rem_1.5rem] gap-2 items-center">
          <input
            className="font-mono text-xs"
            value={a.id}
            onChange={(e) => update((c) => void (c.assets[i].id = e.target.value))}
          />
          <select
            value={a.kind}
            onChange={(e) =>
              update((c) => void (c.assets[i].kind = e.target.value as (typeof ASSET_KINDS)[number]))
            }
          >
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            className="font-mono text-xs"
            value={a.src}
            onChange={(e) => update((c) => void (c.assets[i].src = e.target.value))}
          />
          <select
            value={a.preload ?? 'lazy'}
            onChange={(e) =>
              update((c) => void (c.assets[i].preload = e.target.value as (typeof PRELOADS)[number]))
            }
          >
            {PRELOADS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            className="font-mono text-xs"
            type="number"
            step="0.5"
            value={a.duration ?? ''}
            onChange={(e) =>
              update(
                (c) =>
                  void (c.assets[i].duration =
                    e.target.value === '' ? undefined : Number(e.target.value)),
              )
            }
          />
          <button className="btn-danger" onClick={() => update((c) => void c.assets.splice(i, 1))}>
            ×
          </button>
        </div>
      ))}
      <button
        className="btn w-full"
        onClick={() =>
          update((c) =>
            void c.assets.push({
              id: `asset-${c.assets.length + 1}`,
              kind: 'image',
              src: 'https://media.example.com/placeholder.jpg',
              preload: 'lazy',
            }),
          )
        }
      >
        + asset
      </button>
    </div>
  );
}

/* ---------------------------------------------------------- interactions */

export function InteractionsEditor({
  config,
  update,
}: {
  config: EngineConfig;
  update: Update;
}) {
  return (
    <div className="space-y-2">
      {config.interactions.map((it, i) => (
        <div key={i} className="flex items-center gap-2 flex-wrap border border-ink-800 rounded p-2 bg-ink-900/40">
          <input
            className="w-24 font-mono text-xs"
            value={it.id}
            onChange={(e) => update((c) => void (c.interactions[i].id = e.target.value))}
          />
          <select
            value={it.source}
            onChange={(e) =>
              update(
                (c) => void (c.interactions[i].source = e.target.value as InteractionConfig['source']),
              )
            }
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {(it.source === 'touch' || it.source === 'pointer') && (
            <select
              value={it.gesture ?? ''}
              onChange={(e) =>
                update((c) => {
                  const v = e.target.value;
                  c.interactions[i].gesture =
                    v === '' ? undefined : (v as NonNullable<InteractionConfig['gesture']>);
                })
              }
            >
              <option value="">gesture…</option>
              {['pan', 'pinch', 'swipe', 'tap', 'longpress'].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
          <span className="text-ink-400 text-xs">→</span>
          <select
            title="target scene track"
            value={it.scene}
            onChange={(e) => update((c) => void (c.interactions[i].scene = e.target.value))}
          >
            {config.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
            {!config.scenes.some((s) => s.id === it.scene) && (
              <option value={it.scene}>{it.scene} (missing)</option>
            )}
          </select>
          <input
            className="w-14 font-mono text-xs"
            type="number"
            title="inputRange min"
            value={it.inputRange[0]}
            onChange={(e) =>
              update((c) => void (c.interactions[i].inputRange = [Number(e.target.value), c.interactions[i].inputRange[1]]))
            }
          />
          <input
            className="w-14 font-mono text-xs"
            type="number"
            title="inputRange max"
            value={it.inputRange[1]}
            onChange={(e) =>
              update((c) => void (c.interactions[i].inputRange = [c.interactions[i].inputRange[0], Number(e.target.value)]))
            }
          />
          <button
            className="btn-danger ml-auto"
            onClick={() => update((c) => void c.interactions.splice(i, 1))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="btn w-full"
        onClick={() =>
          update((c) =>
            void c.interactions.push({
              id: `interaction-${c.interactions.length + 1}`,
              source: 'scroll',
              scene: c.scenes[0]?.id ?? '',
              inputRange: [0, 1],
            }),
          )
        }
      >
        + interaction
      </button>
    </div>
  );
}

/**
 * Internal composition helpers shared by all template descriptors.
 * Not part of the public API.
 */

import type {
  AssetEntry,
  AssetManifest,
  ComposedScene,
  EngineConfig,
  InteractionBinding,
  Keyframe,
  SceneConfig,
  SceneNode,
  SceneNodeConfig,
  SceneNodeKind,
  SceneNodePayload,
  TimelineTrack,
  Transform,
} from '@lumen/contracts';

export function identityTransform(): Transform {
  return {
    position: [0, 0, 0],
    rotationQuat: [0, 0, 0, 1],
    scale: [1, 1, 1],
  };
}

let counter = 0;

/** Deterministic-ish id helper; resets per compose() call via resetIds(). */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function resetIds(): void {
  counter = 0;
}

export interface NodeInit {
  id: string;
  kind: SceneNodeKind;
  layer?: number;
  visible?: boolean;
  transform?: Partial<Transform>;
  payload?: SceneNodePayload;
  bindings?: SceneNode['bindings'];
  children?: SceneNode[];
  meta?: Record<string, unknown>;
}

export function makeNode(init: NodeInit): SceneNode {
  return {
    id: init.id,
    kind: init.kind,
    transform: { ...identityTransform(), ...init.transform },
    layer: init.layer ?? 0,
    visible: init.visible ?? true,
    bindings: init.bindings ?? [],
    children: init.children ?? [],
    ...(init.payload !== undefined ? { payload: init.payload } : {}),
    ...(init.meta !== undefined ? { meta: init.meta } : {}),
  };
}

export function makeTrack(
  id: string,
  target: string,
  driver: TimelineTrack['driver'],
  range: [number, number],
  keyframes: Keyframe[],
): TimelineTrack {
  return { id, target, driver, range, keyframes };
}

/** Look up a manifest entry, returning undefined when absent. */
export function manifestEntry(manifest: AssetManifest, id: string | undefined): AssetEntry | undefined {
  if (!id) return undefined;
  return manifest.assets[id];
}

/** Find the first manifest entry of a given kind (deterministic by key order). */
export function firstAssetOfKind<K extends AssetEntry['kind']>(
  manifest: AssetManifest,
  kind: K,
): Extract<AssetEntry, { kind: K }> | undefined {
  for (const key of Object.keys(manifest.assets).sort()) {
    const entry = manifest.assets[key];
    if (entry?.kind === kind) return entry as Extract<AssetEntry, { kind: K }>;
  }
  return undefined;
}

/** Build a SceneNode from a declarative SceneNodeConfig, binding it to a track. */
export function nodeFromConfig(
  nc: SceneNodeConfig,
  scene: SceneConfig,
  trackId: string,
  layer: number,
  templateKind: string,
): SceneNode {
  let payload: SceneNodePayload | undefined;
  if (nc.kind === 'dom') {
    payload = { html: nc.html ?? '' } satisfies SceneNodePayload;
  } else if (nc.kind === 'video-plane' && nc.assetId) {
    payload = { assetId: nc.assetId, scrubbed: scene.track.driver === 'scroll' } satisfies SceneNodePayload;
  } else if ((nc.kind === 'mesh' || nc.kind === 'sprite') && nc.assetId) {
    payload = { assetId: nc.assetId } satisfies SceneNodePayload;
  }
  return makeNode({
    id: nc.id,
    kind: nc.kind,
    layer,
    payload,
    bindings: [{ trackId, property: 'transform.position' }],
    meta: {
      [templateKind]: { slot: scene.slot, a11y: scene.a11y },
      ...(nc.meta ?? {}),
    },
  });
}

/** Scene -> composed target mapping; `range` is the composed track's range. */
export interface SceneRefEntry {
  nodeId: string;
  trackId: string;
  /** Composed track range [start, end]; preferred over the config value. */
  range?: readonly [number, number];
}

/**
 * Resolve declarative InteractionConfig entries into contract InteractionBindings
 * using the scene -> (nodeId, trackId) mapping produced during composition.
 * The binding output range follows the *composed* track range (which may be
 * wider than the scene's own durationOrRange — e.g. a scrub track spanning
 * the full scroll extent); the config value is only a fallback.
 */
export function resolveBindings(
  cfg: EngineConfig,
  sceneRefs: Map<string, SceneRefEntry>,
): InteractionBinding[] {
  const out: InteractionBinding[] = [];
  for (const ic of cfg.interactions) {
    const ref = sceneRefs.get(ic.scene);
    if (!ref) continue; // dangling interaction; registry validation reports it
    const track = cfg.scenes.find((s) => s.id === ic.scene)?.track;
    const end = track && track.durationOrRange > 0 ? track.durationOrRange : 1;
    const outputRange: [number, number] = ref.range ? [ref.range[0], ref.range[1]] : [0, end];
    out.push({
      id: ic.id,
      source: ic.source,
      ...(ic.gesture !== undefined ? { gesture: ic.gesture } : {}),
      targetNodeId: ref.nodeId,
      targetTrackId: ref.trackId,
      mapping: {
        inputRange: ic.inputRange,
        outputRange,
      },
      a11yFallback: ic.a11yFallback ?? 'static',
    });
  }
  return out;
}

/**
 * Dev-mode invariant: config-level validation (`parseConfig` / schema) already
 * rejects duplicate ids, and `registry.validate()` reports unknown slot /
 * target mismatches, so these structural checks are unreachable for any
 * config that passed both. They are consolidated here as a single assertion
 * guarding template internals against hand-built descriptors.
 */
function debugAssertStructuralInvariants(
  sceneGraph: SceneNode[],
  tracks: TimelineTrack[],
  bindings: InteractionBinding[],
): void {
  const nodeIds = new Set<string>();
  const walk = (nodes: SceneNode[]): void => {
    for (const n of nodes) {
      if (nodeIds.has(n.id)) throw new Error(`compose(): duplicate node id '${n.id}'`);
      nodeIds.add(n.id);
      walk(n.children);
    }
  };
  walk(sceneGraph);
  const trackIds = new Set<string>();
  for (const t of tracks) {
    if (trackIds.has(t.id)) throw new Error(`compose(): duplicate track id '${t.id}'`);
    trackIds.add(t.id);
    if (!nodeIds.has(t.target)) throw new Error(`compose(): track '${t.id}' targets unknown node '${t.target}'`);
  }
  for (const b of bindings) {
    if (!trackIds.has(b.targetTrackId)) throw new Error(`compose(): binding '${b.id}' targets unknown track '${b.targetTrackId}'`);
  }
}

/** Assemble the final ComposedScene (structural invariants asserted in dev fashion). */
export function assembleScene(
  sceneGraph: SceneNode[],
  tracks: TimelineTrack[],
  bindings: InteractionBinding[],
  islands: string[],
  ssr: boolean,
): ComposedScene {
  debugAssertStructuralInvariants(sceneGraph, tracks, bindings);
  return { sceneGraph, tracks, bindings, hydration: { ssr, islands } };
}

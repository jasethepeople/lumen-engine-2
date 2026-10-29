/**
 * @lumen/runtime — SceneIR structural contract.
 *
 * SceneIR is the versioned, JSON-serializable scene document emitted by
 * @lumen/codegen (`SceneIR`, schema version 1) and embedded into generated
 * entry modules. Its types are owned by @lumen/contracts; this module keeps
 * the runtime behavior (validation, raising, manifest synthesis).
 */

import type { AssetManifest, ComposedScene, IRAssetRef, IRNode, SceneIR, SceneNode } from '@lumen/contracts';
import { SCENE_IR_VERSION } from '@lumen/contracts';

// SceneIR types are owned by @lumen/contracts (single declaration of the
// codegen -> runtime handshake). Re-exported here so
// `import { SceneIR } from '@lumen/runtime'` keeps working.
export { SCENE_IR_VERSION } from '@lumen/contracts';
export type { IRAssetRef, IRBinding, IRNode, IRTrack, SceneIR } from '@lumen/contracts';

/** Structural check for a SceneIR document (accepts unknown JSON). */
export function isSceneIR(value: unknown): value is SceneIR {
  if (typeof value !== 'object' || value === null) return false;
  const ir = value as Partial<SceneIR>;
  return (
    ir.version === SCENE_IR_VERSION &&
    typeof ir.site === 'object' && ir.site !== null &&
    typeof (ir.site as { id?: unknown }).id === 'string' &&
    Array.isArray(ir.nodes) &&
    Array.isArray(ir.tracks) &&
    Array.isArray(ir.bindings) &&
    Array.isArray(ir.assets) &&
    typeof ir.hydration === 'object' && ir.hydration !== null
  );
}

/** Raise one IRNode subtree into a contract SceneNode. */
function raiseNode(ir: IRNode): SceneNode {
  let payload: SceneNode['payload'];
  switch (ir.kind) {
    case 'dom':
      payload = { html: ir.html ?? '' };
      break;
    case 'video-plane':
      payload = { assetId: ir.assetId ?? '', scrubbed: ir.scrubbed ?? true };
      break;
    case 'mesh':
    case 'sprite':
      payload = { assetId: ir.assetId ?? '' };
      break;
    default:
      payload = undefined;
  }
  return {
    id: ir.id,
    kind: ir.kind,
    transform: ir.transform,
    layer: ir.layer,
    visible: ir.visible,
    bindings: ir.bindings ?? [],
    children: (ir.children ?? []).map(raiseNode),
    payload,
    meta: ir.meta,
  };
}

/**
 * Build a contract ComposedScene from SceneIR. This is the runtime half of
 * codegen's lowering: nodes/tracks/bindings pass through, payloads are
 * re-materialized from their flattened IR fields.
 */
export function composedSceneFromIR(ir: SceneIR): ComposedScene {
  return {
    sceneGraph: ir.nodes.map(raiseNode),
    tracks: ir.tracks.map((t) => ({ ...t })),
    bindings: ir.bindings.map((b) => ({ ...b })),
    hydration: ir.hydration,
  };
}

/**
 * Synthesize a minimal AssetManifest from runtime asset references.
 *
 * The full manifest (responsive variants, byte sizes, posters) is produced by
 * the build pipeline; at boot time the runtime only has `IRAssetRef`s, so it
 * materializes one conservative entry per ref. Unknown/zero dimensions are
 * filled once the asset decodes. Also used by the root `createEngine()` so
 * template composition can resolve asset ids before any build has run.
 */
export function manifestFromAssetRefs(refs: readonly IRAssetRef[]): AssetManifest {
  const assets: AssetManifest['assets'] = {};
  for (const ref of refs) {
    const preload = ref.preload ?? 'lazy';
    const base = { id: ref.id, preload, bytes: 0 };
    switch (ref.kind) {
      case 'image':
        assets[ref.id] = {
          ...base,
          kind: 'image',
          width: 0,
          height: 0,
          variants: { fallback: { url: ref.src, mime: 'image/*' } },
        };
        break;
      case 'video':
        assets[ref.id] = {
          ...base,
          kind: 'video',
          // Non-finite/<=0 durations mean "unknown" — templates fall back
          // to the scroll range instead of collapsing scrub to a no-op.
          duration:
            typeof ref.duration === 'number' && Number.isFinite(ref.duration) && ref.duration > 0
              ? ref.duration
              : 0,
          width: 0,
          height: 0,
          poster: '',
          variants: { mp4: { url: ref.src, bytes: 0, codec: 'h264' } },
          scrubOptimized: true,
        };
        break;
      case 'model':
        assets[ref.id] = {
          ...base,
          kind: 'model',
          url: ref.src,
          textures: 'webp-fallback',
          draco: false,
          bounds: { min: [0, 0, 0], max: [0, 0, 0] },
        };
        break;
      case 'font':
        assets[ref.id] = {
          ...base,
          kind: 'font',
          family: ref.id,
          url: ref.src,
          weight: 400,
          style: 'normal',
        };
        break;
      case 'lottie':
        assets[ref.id] = { ...base, kind: 'lottie', url: ref.src, duration: 0, frameRate: 60 };
        break;
      case 'audio':
        assets[ref.id] = { ...base, kind: 'audio', duration: 0, variants: {} };
        break;
    }
  }
  return { version: 1, generatedAt: new Date(0).toISOString(), assets };
}

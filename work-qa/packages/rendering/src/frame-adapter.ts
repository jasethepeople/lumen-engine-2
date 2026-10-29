/**
 * World-state → DrawCall adapter.
 *
 * Rendering owns the payload conventions its renderers decode (DomRenderer:
 * `{kind, html?, assetId?, rect, opacity?, transform?, visible?}`; mesh/sprite
 * payloads carry the raw world transform for the WebGL MeshFactory). The
 * runtime orchestrates scene evaluation and calls into this adapter; changing
 * a renderer's payload decoding only requires editing this package.
 */

import type { DrawCall, SceneNode, Transform } from '@lumen/contracts';
import type { WorldState } from '@lumen/scene';

/** Viewport surface size used to derive DOM rect fallbacks. */
export interface SurfaceSize {
  width: number;
  height: number;
}

/** Read the effective opacity a binding may have written to payload.material. */
function nodeOpacity(node: SceneNode): number {
  const material = (node.payload as { material?: Record<string, unknown> } | undefined)?.material;
  const opacity = material?.opacity;
  return typeof opacity === 'number' ? opacity : 1;
}

/** CSS transform for the non-translation part of a world transform. */
function cssTransform(t: Transform): string | undefined {
  const [sx, sy] = t.scale;
  if (sx === 1 && sy === 1) return undefined;
  return `scale(${sx}, ${sy})`;
}

/**
 * Adapt one scene node + its world transform into a DrawCall following the
 * renderer payload conventions above. Returns null for node kinds that
 * produce no draw call (groups/cameras/lights).
 */
export function drawCallForNode(
  node: SceneNode,
  world: Transform,
  surface: SurfaceSize,
): DrawCall | null {
  const rect = {
    x: world.position[0],
    y: world.position[1],
    width: Math.max(0, surface.width - world.position[0]),
    height: Math.max(0, surface.height - world.position[1]),
  };
  switch (node.kind) {
    case 'dom':
      return {
        nodeId: node.id,
        layer: node.layer,
        payload: {
          kind: 'dom',
          html: (node.payload as { html?: string } | undefined)?.html ?? '',
          rect,
          opacity: nodeOpacity(node),
          transform: cssTransform(world),
          visible: node.visible,
        },
      };
    case 'video-plane':
      return {
        nodeId: node.id,
        layer: node.layer,
        payload: {
          kind: 'video',
          assetId: (node.payload as { assetId?: string } | undefined)?.assetId ?? '',
          rect,
          opacity: nodeOpacity(node),
          transform: cssTransform(world),
          visible: node.visible,
        },
      };
    case 'mesh':
    case 'sprite':
      return {
        nodeId: node.id,
        layer: node.layer,
        payload: {
          kind: node.kind,
          assetId: (node.payload as { assetId?: string } | undefined)?.assetId ?? '',
          transform: world,
          material: (node.payload as { material?: Record<string, unknown> } | undefined)?.material,
        },
      };
    default:
      return null; // groups/cameras/lights produce no draw call
  }
}

/** Adapt a whole WorldState snapshot into a layer-sorted draw list. */
export function drawCallsFromWorldState(world: WorldState, surface: SurfaceSize): DrawCall[] {
  const drawList: DrawCall[] = [];
  for (const entry of world.entries) {
    if (!entry.visible) continue;
    const call = drawCallForNode(entry.node, entry.worldTransform, surface);
    if (call) drawList.push(call);
  }
  drawList.sort((a, b) => a.layer - b.layer);
  return drawList;
}

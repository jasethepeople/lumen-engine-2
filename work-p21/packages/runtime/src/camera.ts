/**
 * @lumen/runtime — camera resolution (P5).
 *
 * Camera tracks bind to a 'camera' scene node like any other transform
 * track; after bindings are applied and world transforms updated, the
 * camera node's world transform drives `RenderFrame.camera`. Scenes without
 * a camera node get the byte-identical DEFAULT_CAMERA.
 *
 * Target derivation: optional `meta.lookAt: Vec3` on the camera node wins;
 * otherwise the target is `position + forward(rotationQuat)` with forward
 * being the -Z axis rotated by the world quaternion (matching the default
 * camera at z=+5 looking at the origin).
 */

import type { CameraState, Quat, SceneNode, Vec3 } from '@lumen/contracts';

/**
 * Depth-first search for the first 'camera' node. Graphs are static
 * post-raise, so callers memoize the result at boot (R3: no per-frame DFS).
 */
export function findFirstCameraNodeId(roots: readonly SceneNode[]): string | undefined {
  for (const node of roots) {
    if (node.kind === 'camera') return node.id;
    const found = findFirstCameraNodeId(node.children);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Rotate v by quaternion q (assumed unit, as produced by the scene graph). */
function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [x, y, z] = v;
  // t = 2 * q.xyz × v
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number');
}

export interface CameraResolutionContext {
  /** World transform of the camera node this frame, when one exists. */
  world: { position: Vec3; rotationQuat: Quat } | undefined;
  /** The camera node itself (for meta.lookAt), when one exists. */
  node: SceneNode | undefined;
  /** Fallback camera used when no camera node exists. */
  defaultCamera: CameraState;
}

/**
 * Resolve the RenderFrame camera for this frame. No camera node ⇒ the exact
 * `defaultCamera` reference (byte-identical frames for camera-less scenes).
 */
export function resolveCamera(ctx: CameraResolutionContext): CameraState {
  const { world, node, defaultCamera } = ctx;
  if (!world || !node) return defaultCamera;
  const lookAt = node.meta?.['lookAt'];
  const target: Vec3 = isVec3(lookAt)
    ? [lookAt[0], lookAt[1], lookAt[2]]
    : ((): Vec3 => {
        const f = quatRotate(world.rotationQuat, [0, 0, -1]);
        return [world.position[0] + f[0], world.position[1] + f[1], world.position[2] + f[2]];
      })();
  return {
    ...defaultCamera,
    position: [world.position[0], world.position[1], world.position[2]],
    target,
  };
}

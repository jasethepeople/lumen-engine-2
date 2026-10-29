/**
 * @lumen/app-ai — camera track suggestions.
 *
 * Suggests keyframe sequences for camera moves using the engine's frozen
 * track conventions: Keyframe.t positions, Vec3 positions, optional scalar
 * zoom (field-of-view multiplier), named easing plus wire-faithful cubic
 * bezier curves (Keyframe.easing / Keyframe.easingBezier).
 */

import type { CubicBezier, EasingName, SceneConfig, Vec3 } from '@lumen/contracts';

/** One suggested camera keyframe. */
export interface CameraKeyframe {
  /** Time position within the track range. */
  t: number;
  /** Camera world position. */
  position?: Vec3;
  /** Zoom multiplier (1 = neutral; <1 wide, >1 tight). */
  zoom?: number;
  /** Named easing to the next keyframe (degrades gracefully). */
  easing?: EasingName;
  /** Wire-faithful cubic bezier easing, preferred over `easing`. */
  easingBezier?: CubicBezier;
}

/** Reference to the scene a camera move is suggested for. */
export type CameraSceneRef =
  | string
  | Pick<SceneConfig, 'id' | 'track'>
  | { id: string; duration?: number };

/** Named camera move presets. */
export type CameraMove = 'push-in' | 'pull-back' | 'orbit' | 'pan' | 'settle';

const EASE_SMOOTH: CubicBezier = [0.22, 0.61, 0.36, 1];
const EASE_EMPHASIZED: CubicBezier = [0.16, 1, 0.3, 1];

function resolveRef(ref: CameraSceneRef): { id: string; duration: number } {
  if (typeof ref === 'string') return { id: ref, duration: 6 };
  if ('track' in ref && ref.track) {
    return { id: ref.id, duration: Math.max(0.0001, ref.track.durationOrRange) };
  }
  const withDuration = ref as { id: string; duration?: number };
  return { id: withDuration.id, duration: Math.max(0.0001, withDuration.duration ?? 6) };
}

/**
 * Suggest camera keyframes for a scene. Defaults to a gentle 'push-in'
 * covering the scene's full track range; positions use the engine's
 * right-handed Vec3 convention with the camera on +Z looking at origin.
 */
export function suggestCameraTracks(
  sceneRef: CameraSceneRef,
  move: CameraMove = 'push-in',
): CameraKeyframe[] {
  const { duration } = resolveRef(sceneRef);
  const end = duration;
  const mid = duration / 2;
  switch (move) {
    case 'push-in':
      return [
        { t: 0, position: [0, 0.4, 6.5], zoom: 1, easing: 'ease-in-out', easingBezier: EASE_SMOOTH },
        { t: end, position: [0, 0.2, 4.2], zoom: 1.12 },
      ];
    case 'pull-back':
      return [
        { t: 0, position: [0, 0.2, 4.2], zoom: 1.12, easing: 'ease-in-out', easingBezier: EASE_SMOOTH },
        { t: end, position: [0, 0.6, 7.5], zoom: 1 },
      ];
    case 'orbit':
      return [
        { t: 0, position: [5.5, 0.5, 3.2], zoom: 1, easing: 'ease-in-out', easingBezier: EASE_SMOOTH },
        { t: mid, position: [0, 0.7, 6.4], zoom: 1.05, easing: 'ease-in-out', easingBezier: EASE_SMOOTH },
        { t: end, position: [-5.5, 0.5, 3.2], zoom: 1 },
      ];
    case 'pan':
      return [
        { t: 0, position: [-2.4, 0.3, 5.6], zoom: 1, easing: 'linear', easingBezier: [0, 0, 1, 1] },
        { t: end, position: [2.4, 0.3, 5.6], zoom: 1 },
      ];
    case 'settle':
      return [
        { t: 0, position: [0, 1.4, 8.4], zoom: 0.95, easing: 'ease-out', easingBezier: EASE_EMPHASIZED },
        { t: end, position: [0, 0.3, 5.4], zoom: 1 },
      ];
  }
}

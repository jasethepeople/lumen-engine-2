/**
 * @lumen/app-ai — motion profile suggestions.
 *
 * Recommends per-scene reduced-motion modes and track-level smoothing /
 * segment shapes that match the contracts TimelineTrack conventions
 * (MotionMode, TrackSmoothing, TrackSegment from @lumen/contracts).
 */

import type {
  EngineConfig,
  MotionMode,
  SceneConfig,
  TrackSegment,
  TrackSmoothing,
} from '@lumen/contracts';

/** The suggested motion profile for one scene. */
export interface MotionSuggestion {
  /** SceneConfig.id this suggestion applies to. */
  sceneId: string;
  suggested: {
    /** Recommended scene/track motion mode. */
    motion: MotionMode;
    /** Recommended driver-level interpolation policy (when useful). */
    smoothing?: TrackSmoothing;
    /** Recommended reusable keyframe segments (when useful). */
    segments?: TrackSegment[];
  };
  /** Why this profile was chosen. */
  rationale: string;
}

function hasKind(scene: SceneConfig, kind: SceneConfig['nodes'][number]['kind']): boolean {
  return scene.nodes.some((n) => n.kind === kind);
}

/** Standard reveal-in segment over the first portion of a track. */
function revealSegment(sceneId: string, to: number): TrackSegment {
  return {
    id: `seg-${sceneId}-reveal`,
    from: 0,
    to: Math.max(0.0001, to),
    keys: [
      { t: 0, value: 0, easing: 'ease-out', easingBezier: [0.22, 0.61, 0.36, 1] },
      { t: 1, value: 1 },
    ],
  };
}

/** Suggest a motion profile for one scene based on its content. */
export function suggestSceneMotion(scene: SceneConfig): MotionSuggestion {
  if (hasKind(scene, 'video-plane')) {
    return {
      sceneId: scene.id,
      suggested: {
        motion: 'continuous',
        smoothing: { mode: 'lerp', stiffness: 0.18 },
      },
      rationale:
        'Scene contains a video plane: recommend continuous playback/scrub with lerp smoothing so frame updates feel fluid.',
    };
  }
  const mediaCount = scene.nodes.filter((n) => n.kind === 'sprite' || n.kind === 'mesh').length;
  if (scene.slot === 'gallery' || mediaCount >= 3) {
    return {
      sceneId: scene.id,
      suggested: {
        motion: 'static',
        segments: [
          {
            id: `seg-${scene.id}-parallax`,
            from: 0,
            to: Math.max(0.0001, scene.track.durationOrRange),
            keys: [
              { t: 0, value: [0, 0, 0], easing: 'linear' },
              { t: 1, value: [0, -0.35, 0], easing: 'linear' },
            ],
          },
        ],
      },
      rationale:
        'Gallery-style scene with multiple media nodes: recommend a mostly static layout with an optional subtle parallax segment.',
    };
  }
  if (hasKind(scene, 'mesh')) {
    return {
      sceneId: scene.id,
      suggested: {
        motion: 'continuous',
        smoothing: { mode: 'spring', stiffness: 90, damping: 14 },
      },
      rationale:
        'Scene hosts a 3D model: recommend continuous pointer/time-driven motion with spring smoothing for tactile control.',
    };
  }
  if (hasKind(scene, 'dom')) {
    return {
      sceneId: scene.id,
      suggested: {
        motion: 'reveal',
        segments: [revealSegment(scene.id, Math.min(1, scene.track.durationOrRange))],
      },
      rationale:
        'Text/DOM chapter: recommend reveal motion with a single ease-out reveal segment; cuts (not lerps) keep text legible under reduced motion.',
    };
  }
  return {
    sceneId: scene.id,
    suggested: { motion: 'static' },
    rationale: 'No animatable content detected: recommend static presentation.',
  };
}

/** Suggest motion profiles for every scene of a validated config. */
export function suggestMotionProfiles(config: EngineConfig): MotionSuggestion[] {
  return config.scenes.map((scene) => suggestSceneMotion(scene));
}

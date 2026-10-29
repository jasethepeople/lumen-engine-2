/**
 * @lumen/contracts — scene graph domain.
 * Node hierarchy, transforms, timelines, keyframes, and property bindings.
 * The scene graph is template-agnostic and serializable; renderers derive views from it.
 */

/** 2-component vector [x, y]. */
export type Vec2 = [number, number];

/** 3-component vector [x, y, z]. */
export type Vec3 = [number, number, number];

/** 4-component quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

/** Local transform of a scene node; world transform is computed by the scene module. */
export interface Transform {
  /** Local position. */
  position: Vec3;
  /** Local rotation as a quaternion. */
  rotationQuat: Quat;
  /** Local scale (multiplicative). */
  scale: Vec3;
}

/** Named easing curve identifiers. */
export type EasingName = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step';

/** Cubic bezier easing control points [x1, y1, x2, y2]. */
export type CubicBezier = [number, number, number, number];

/** Node type discriminant for SceneNode. */
export type SceneNodeKind = 'group' | 'mesh' | 'video-plane' | 'dom' | 'camera' | 'light' | 'sprite';

/** Attachment of a timeline track to an animatable node property. */
export interface PropertyBinding {
  /** References TimelineTrack.id. */
  trackId: string;
  /** Dotted property path, e.g. 'transform.position.y', 'material.opacity'. */
  property: string;
  /** Optional easing override applied between keyframes. */
  easing?: EasingName | CubicBezier;
}

/** Payload for 'mesh' and 'sprite' nodes. */
export interface MeshPayload {
  /** AssetManifest id of the model/texture asset. */
  assetId: string;
  /** Material parameters (template/renderer specific). */
  material?: Record<string, number | number[] | string>;
}

/** Payload for 'dom' nodes (hybrid DOM/spatial scenes). */
export interface DomPayload {
  /** HTML template string or SSR fragment id. */
  html: string;
  /** Optional 3D anchor position; node projects to screen space. */
  anchor?: Vec3;
  /**
   * Optional explicit CSS rect (P11). When present the DOM renderer uses it
   * verbatim instead of deriving a rect from the surface size and world
   * position; bindings may animate `payload.rect.width` etc. via setByPath.
   */
  rect?: { x: number; y: number; width: number; height: number };
  /**
   * Optional stacking-context group name (P11). Elements naming the same
   * group are parented to a shared absolutely-positioned group div whose
   * z-index is the group's minimum layer; element z-index becomes
   * group-relative. Absent = flat overlay (legacy behavior).
   */
  layerGroup?: string;
}

/** Payload for 'video-plane' nodes. */
export interface VideoPayload {
  /** AssetManifest id of the video asset. */
  assetId: string;
  /** Whether the playhead is scrubbed by a timeline track vs. free playback. */
  scrubbed: boolean;
}

/** Union of node payloads, keyed by SceneNode.kind. */
export type SceneNodePayload = MeshPayload | DomPayload | VideoPayload;

/** A node in the serializable scene graph. */
export interface SceneNode {
  /** Unique node id (stable across serialization). */
  id: string;
  /** Node type. */
  kind: SceneNodeKind;
  /** Local transform; world transform is derived. */
  transform: Transform;
  /** Render-layer ordering key (higher draws later). */
  layer: number;
  /** Visibility flag; invisible subtrees are skipped. */
  visible: boolean;
  /** Timeline attachments. */
  bindings: PropertyBinding[];
  /** Child nodes. */
  children: SceneNode[];
  /** Kind-specific payload. */
  payload?: SceneNodePayload;
  /** Template-specific metadata, namespaced by template (e.g. meta['viewer-3d']). */
  meta?: Record<string, unknown>;
}

/** A single keyframe on a TimelineTrack. */
export interface Keyframe {
  /** Time position within the track range. */
  t: number;
  /** Keyframed value: scalar, vector, or discrete string. */
  value: number | number[] | string;
  /** Easing applied from this keyframe to the next. */
  easing?: EasingName;
  /**
   * Wire-faithful cubic bezier easing (P15); preferred over the named
   * `easing` when both are present. Codegen also writes the nearest named
   * easing into `easing` so old runtimes degrade gracefully.
   */
  easingBezier?: CubicBezier;
}

/** Driver-level interpolation descriptor for a track (P15). */
export interface TrackSmoothing {
  mode: 'lerp' | 'spring' | 'none';
  /** Lerp factor per 60fps frame ('lerp') or spring stiffness ('spring'). */
  stiffness?: number;
  /** Spring damping ratio input ('spring' only). */
  damping?: number;
}

/** A reusable keyframe segment flattened into a track at evaluation (P15). */
export interface TrackSegment {
  id: string;
  /** Segment window in track time; local key t (0..1) maps into [from, to]. */
  from: number;
  to: number;
  keys: Keyframe[];
}

/** An animation track attached to scene nodes via PropertyBinding. */
export interface TimelineTrack {
  /** Unique track id, referenced by PropertyBinding.trackId and InteractionBinding.targetTrackId. */
  id: string;
  /** Default SceneNode.id target (bindings may target additional nodes). */
  target: string;
  /** Sparse keyframes, sorted by t. */
  keyframes: Keyframe[];
  /** What advances the playhead. */
  driver: 'time' | 'scroll' | 'pointer' | 'playback';
  /** Playable range: seconds (time/playback) or scroll units (scroll/pointer). */
  range: [number, number];
  /** Per-track reduced-motion override (P1); absent = inherit scene/default. */
  motion?: import('./ir.js').MotionMode;
  /** Driver-level interpolation policy (P15); absent = global smoothing. */
  smoothing?: TrackSmoothing;
  /** Reusable keyframe segments merged into the keyframe stream (P15). */
  segments?: TrackSegment[];
}

/**
 * Output of template composition: a fully-resolved scene ready for
 * serialization, codegen, and runtime hydration.
 */
export interface ComposedScene {
  /** Root nodes of the composed scene graph. */
  sceneGraph: SceneNode[];
  /** All timeline tracks. */
  tracks: TimelineTrack[];
  /** Interaction bindings resolved for this scene. */
  bindings: import('./interaction.js').InteractionBinding[];
  /** Hydration hints for codegen/runtime. */
  hydration: {
    /** Whether SSR HTML is emitted for DOM regions. */
    ssr: boolean;
    /** DOM anchor ids that hydrate as islands. */
    islands: string[];
  };
}

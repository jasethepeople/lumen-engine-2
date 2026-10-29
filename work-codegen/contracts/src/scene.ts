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

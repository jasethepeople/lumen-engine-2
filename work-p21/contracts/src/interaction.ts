/**
 * @lumen/contracts — interaction domain.
 * Input normalization, gestures, and bindings that map input domains to timeline ranges.
 */

import type { Vec2 } from './scene.js';

/** Raw input origins normalized by the interaction layer. */
export type InputSource = 'scroll' | 'pointer' | 'touch' | 'keyboard' | 'deviceorientation';

/** Recognized composable gesture types. */
export type GestureType = 'pan' | 'pinch' | 'swipe' | 'tap' | 'longpress';

/**
 * A single normalized input event in unified coordinate space.
 * All coordinates/deltas are normalized to viewport units (0–1).
 */
export interface NormalizedInputEvent {
  /** Input origin. */
  source: InputSource;
  /** DOMHighResTimeStamp (milliseconds). */
  timestamp: number;
  /** Movement since previous event, viewport-normalized. */
  delta: Vec2;
  /** Absolute position, viewport-normalized. */
  position: Vec2;
  /** Current velocity estimate, viewport units per second. */
  velocity: Vec2;
  /** Active keyboard modifiers. */
  modifiers: { shift: boolean; ctrl: boolean; alt: boolean };
}

/** Smoothing model applied to a bound input stream. */
export interface SmoothingConfig {
  /** Smoothing algorithm. */
  type: 'lerp' | 'spring';
  /** Algorithm factor (lerp alpha or spring stiffness heuristic, 0–1). */
  factor: number;
}

/** Accessibility degradation mode for a binding. */
export type A11yFallback = 'steps' | 'static' | 'native-video';

/**
 * Maps an input domain (scroll range, drag delta, device tilt) onto a timeline
 * track range, optionally with snap points and smoothing.
 */
export interface InteractionBinding {
  /** Unique binding id. */
  id: string;
  /** Input origin driving this binding. */
  source: InputSource;
  /** Gesture subtype when the binding is gesture-driven. */
  gesture?: GestureType;
  /** SceneNode.id whose track(s) are driven. */
  targetNodeId: string;
  /** TimelineTrack.id being driven. */
  targetTrackId: string;
  /** Domain mapping between input units and timeline seconds. */
  mapping: {
    /** Input domain in px, radians, or unit deltas. */
    inputRange: [number, number];
    /** Timeline output range in seconds. */
    outputRange: [number, number];
    /** Smoothing applied to the mapped output. */
    smoothing?: SmoothingConfig;
    /** Snap points within outputRange (seconds). */
    snap?: number[];
  };
  /** Degradation mode under prefers-reduced-motion / assistive tech. */
  a11yFallback: A11yFallback;
}

/** Virtual scroll playhead contract (smoothed, clamped scroll → progress mapping). */
export interface VirtualScroller {
  /** Smoothed progress, 0–1. */
  readonly progress: number;
  /** Attach to a scroll container element. */
  attach(el: HTMLElement): void;
  /** Programmatically move the playhead. */
  seek(p: number, opts?: { animate?: boolean }): void;
  /** Enable/disable input processing (e.g. during modal overlays). */
  setEnabled(on: boolean): void;
}

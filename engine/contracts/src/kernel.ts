/**
 * @lumen/contracts — kernel domain.
 * Lifecycle state machine, typed event bus map, capability detection,
 * plugin registry, and scheduler/budget reporting contracts.
 */

/** Engine lifecycle phases, in order: created → booting → loading → ready → active → paused → disposed. */
export type LifecyclePhase =
  | 'created'
  | 'booting'
  | 'loading'
  | 'ready'
  | 'active'
  | 'paused'
  | 'disposed';

/** Codec support probe result (from MediaCapabilities.decodingInfo, or static fallback table). */
export interface CodecSupport {
  /** Codec can be decoded at all. */
  supported: boolean;
  /** Smooth playback expected at the device's performance class. */
  smooth: boolean;
  /** Hardware/power-efficient decode path available. */
  powerEfficient: boolean;
}

/** Immutable device/browser capability snapshot, produced once at kernel boot. */
export interface CapabilityProfile {
  /** WebGL2 context available. */
  readonly webgl2: boolean;
  /** WebGPU available (navigator.gpu + adapter). */
  readonly webgpu: boolean;
  /** OffscreenCanvas supported (enables worker rendering). */
  readonly offscreenCanvas: boolean;
  /** Per-codec decode support. */
  readonly codecs: Record<'h264' | 'hevc' | 'av1' | 'vp9', CodecSupport>;
  /** Maximum texture dimension in pixels. */
  readonly maxTextureSize: number;
  /** navigator.deviceMemory, or null when unavailable. */
  readonly deviceMemoryGB: number | null;
  /** prefers-reduced-motion media query is active. */
  readonly reducedMotion: boolean;
  /** Device pixel ratio envelope used by adaptive quality. */
  readonly dpr: { min: number; max: number; current: number };
}

/** Structured engine error reported through the event bus and error boundaries. */
export interface EngineError {
  /** Module that raised the error (e.g. 'rendering', 'assets'). */
  module: string;
  /** Stable machine-readable error code. */
  code: string;
  /** Whether the engine can continue after the error. */
  recoverable: boolean;
  /** Original error/cause, if any. */
  cause?: unknown;
}

/** Scheduler frame-budget report, emitted when a frame exceeds its allotted time. */
export interface BudgetReport {
  /** Actual frame time in milliseconds. */
  frameMs: number;
  /** Scheduler phase that blew the budget (e.g. 'render', 'timeline'). */
  phase: string;
  /** Configured per-frame budget in milliseconds. */
  budgetMs: number;
  /**
   * P4: attribution. Undefined = scheduler-originated (legacy semantics);
   * 'longtask' marks externally-attributed long tasks (>50 ms) observed via
   * PerformanceObserver with `phase: 'external'`.
   */
  source?: 'scheduler' | 'longtask';
}

/**
 * Typed event map for the kernel event bus. Keys are event names; values are payload types.
 * All cross-module communication flows through events declared here.
 */
export interface EngineEventMap {
  /** Lifecycle state machine transition. */
  'lifecycle:change': { from: LifecyclePhase; to: LifecyclePhase };
  /** Emitted when entering a specific phase (convenience alias of lifecycle:change). */
  'lifecycle:enter': { phase: LifecyclePhase };
  /** Emitted when leaving a specific phase. */
  'lifecycle:leave': { phase: LifecyclePhase };
  /** Scheduler frame overrun. */
  'scheduler:budget-exceeded': BudgetReport;
  /** P4: document visibility transitions (guarded; browser-only emission). */
  'engine:visibility': { state: 'hidden' | 'visible' };
  /** Contained module error from an error boundary. */
  'engine:error': EngineError;
  /** Asset preload progress. */
  'asset:progress': { loaded: number; total: number; assetId?: string };
  /** Scene transition (entering a scene section). */
  'scene:enter': { sceneId: string; index: number };
  /** Scene transition (leaving a scene section). */
  'scene:leave': { sceneId: string; index: number };
  /** Semantic navigation request from the interaction layer. */
  'scene:next': Record<string, never>;
  /** Semantic navigation request from the interaction layer. */
  'scene:prev': Record<string, never>;
  /** Timeline playhead moved. */
  'timeline:seek': { time: number; source: 'user' | 'programmatic' };
  /** Adaptive quality tier changed. */
  'render:quality-change': { dprScale: number; backend: string };
  /**
   * P17: emitted exactly once after the first frame is rendered — the
   * signal that SSR poster placeholders have been swapped for live pixels.
   */
  'render:first-frame': { drawCalls: number };
}

/** Plugin contract: declares capability tokens and lifecycle hooks. */
export interface LumenPlugin {
  /** Unique plugin name. */
  readonly name: string;
  /** Semver version string. */
  readonly version: string;
  /** Capability tokens this plugin provides, e.g. 'renderer:webgpu'. */
  readonly provides?: readonly string[];
  /** Capability tokens this plugin requires (dependency DAG input). */
  readonly consumes?: readonly string[];
  /**
   * P14: when true, an init failure degrades gracefully — the error is
   * reported with `recoverable: true` and boot continues without the plugin,
   * UNLESS another registered plugin consumes a token this plugin provides
   * (unmet mandatory dependency ⇒ boot still aborts). Default false.
   */
  readonly optional?: boolean;
  /** Called during boot, in topological dependency order. */
  init(ctx: KernelContext): void | Promise<void>;
  /** Called on engine disposal. */
  dispose(): void | Promise<void>;
}

/** Narrowed context handed to plugins at init: capabilities + bus access + error reporting. */
export interface KernelContext {
  /** Immutable capability snapshot. */
  readonly capabilities: CapabilityProfile;
  /** Subscribe to a typed bus event; returns an unsubscribe function. */
  readonly events: KernelHandle['on'];
  /** Report a structured error through the engine error boundary. */
  reportError(err: EngineError): void;
}

/** Public kernel handle returned by createEngine; lifecycle control + typed event subscription. */
export interface KernelHandle {
  /** Current lifecycle phase. */
  readonly phase: LifecyclePhase;
  /** Immutable capability snapshot. */
  readonly capabilities: CapabilityProfile;
  /** Boot the engine: capability detection, plugin init, asset preload, first frame. */
  start(): Promise<void>;
  /** Pause the frame loop (active → paused). */
  pause(): void;
  /** Resume the frame loop (paused → active). */
  resume(): void;
  /** Tear down the engine and all plugins (→ disposed). */
  dispose(): Promise<void>;
  /**
   * Subscribe to a typed bus event.
   * @returns Unsubscribe function.
   */
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void,
  ): () => void;
}

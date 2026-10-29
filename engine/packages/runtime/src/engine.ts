/**
 * @lumen/runtime — browser boot orchestration.
 *
 * Thin glue that wires the module packages together at runtime:
 *
 *   SceneIR (JSON) ──▶ ComposedScene ──▶ SceneRuntime ─┐
 *                                                      ├─▶ RenderFrame ──▶ IRenderer
 *   InteractionManager ──▶ DriverMap ──▶ playheads ────┘        (kernel scheduler loop)
 *
 * Boot sequence (kernel lifecycle):
 *   created → booting (capabilities) → loading (asset preload plugin) →
 *   ready (renderer + interaction + frame loop registered) → active.
 *
 * All DOM access is guarded: importing this module under Node is safe;
 * bootEngine() throws a plain Error when no DOM is present.
 */

import type {
  CameraState,
  CapabilityProfile,
  DrawCall,
  EngineError,
  EngineEventMap,
  FrameStats,
  IRenderer,
  KernelHandle,
  LifecyclePhase,
  MotionMode,
  QualityLevel,
  RenderFrame,
  RendererBackend,
  SceneNode,
} from '@lumen/contracts';
import { createKernel, type Kernel, type KernelOptions } from '@lumen/kernel';
import {
  applyBindings,
  createSceneRuntime,
  resolvePlayheads,
  type SceneRuntime,
} from '@lumen/scene';
import {
  AdaptiveQualityController,
  createRenderer,
  drawCallForNode,
  selectRenderer,
} from '@lumen/rendering';
import { createAssetManager, type AssetManager } from '@lumen/assets';
import { InteractionManager, type DriverMap } from '@lumen/interaction';
import {
  composedSceneFromIR,
  describeSceneIRError,
  manifestFromAssetRefs,
  type SceneIR,
} from './ir.js';
import { createMotionPolicy } from './motion.js';
import { findFirstCameraNodeId, resolveCamera } from './camera.js';
import { collectScrubTargets, createScrubber } from './scrub.js';

/** Options accepted by bootEngine(). */
export interface BootOptions {
  /** Kernel overrides (scheduler budget, injectable clock/frame source, capabilities). */
  kernel?: KernelOptions;
  /** CDN base prepended to manifest-relative asset URLs. */
  cdnBase?: string;
  /** Fetch override forwarded to the asset manager. */
  fetchImpl?: typeof fetch;
  /** Force a renderer backend; default is capability-based selection. */
  renderer?: RendererBackend;
  /** Force reduced-motion behavior; default follows the capability profile. */
  reducedMotion?: boolean;
  /** Post-process pass names managed by the adaptive quality ladder. */
  postPasses?: string[];
}

/** The live engine handle returned by bootEngine(). */
export interface LumenEngine {
  readonly kernel: Kernel;
  readonly scene: SceneRuntime;
  readonly renderer: IRenderer;
  readonly assets: AssetManager;
  readonly interaction: InteractionManager;
  readonly ir: SceneIR;
  readonly phase: LifecyclePhase;
  readonly capabilities: CapabilityProfile;
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void,
  ): () => void;
  pause(): void;
  resume(): void;
  dispose(): Promise<void>;
}

/** Default camera used when the scene graph carries no camera node. */
const DEFAULT_CAMERA: CameraState = {
  position: [0, 0, 5],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fov: 50,
  near: 0.1,
  far: 100,
};

/** Runtime package version, compared against SceneIR.minRuntime (P8). */
export const LUMEN_RUNTIME_VERSION = '0.1.0';

/**
 * P8: thrown by parseSceneIR when a document declares a `minRuntime`
 * newer than this runtime — a deploy skew (stale runtime, fresh site).
 * Carries the semver strings so hosts can log/report precisely.
 */
export class VersionSkewError extends Error {
  override readonly name = 'VersionSkewError';
  /** Minimum runtime version the document requires. */
  readonly expected: string;
  /** Version of the runtime that rejected the document. */
  readonly got: string;
  constructor(expected: string, got: string) {
    super(
      `@lumen/runtime: SceneIR requires runtime >= ${expected}, but this runtime is ${got} (IR_VERSION_SKEW)`,
    );
    this.expected = expected;
    this.got = got;
  }
}

/** Compare two dotted numeric semver strings: <0 a<b, 0 equal, >0 a>b. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split('.').map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Parse/accept a SceneIR document (object or JSON string). */
export function parseSceneIR(input: SceneIR | string | unknown): SceneIR {
  const value = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  const problem = describeSceneIRError(value);
  if (problem !== null) {
    throw new Error(`@lumen/runtime: invalid SceneIR document — ${problem}`);
  }
  const ir = value as SceneIR;
  // P8: version-skew guard. Structural validation (isSceneIR) still accepts
  // the document — only booting it with an older runtime is rejected.
  if (typeof ir.minRuntime === 'string' && compareSemver(ir.minRuntime, LUMEN_RUNTIME_VERSION) > 0) {
    throw new VersionSkewError(ir.minRuntime, LUMEN_RUNTIME_VERSION);
  }
  return ir;
}

/**
 * Boot a generated site: hydrate SceneIR into a live engine and start the
 * frame loop. Requires a DOM (guarded); throws under Node.
 */
export async function bootEngine(
  rootElement: HTMLElement,
  irInput: SceneIR | string | unknown,
  options: BootOptions = {},
): Promise<LumenEngine> {
  if (typeof document === 'undefined') {
    throw new Error('@lumen/runtime: bootEngine() requires a DOM (browser) environment');
  }
  if (!rootElement) throw new Error('@lumen/runtime: rootElement is required');
  if (rootElement.dataset.lumenBooted === 'true') {
    throw new Error(
      '@lumen/runtime: bootEngine() called twice on the same root element; dispose the previous engine first',
    );
  }
  const kernel = createKernel(options.kernel);
  // From here on, any failure must dispose the kernel (plugins, scheduler,
  // asset handles) and remove a partially appended canvas before rethrowing.
  let surface: HTMLCanvasElement | null = null;
  let onResize: (() => void) | null = null;
  try {
  const bus = kernel.bus;
  let ir: SceneIR;
  try {
    ir = parseSceneIR(irInput);
  } catch (err) {
    // P8: version skew — degrade gracefully. The SSR skeleton (incl. P17
    // poster imgs) stays in the DOM untouched; hosts get a typed
    // engine:error with code IR_VERSION_SKEW before the kernel tears down.
    if (err instanceof VersionSkewError) {
      bus.emit('engine:error', {
        module: 'runtime',
        code: 'IR_VERSION_SKEW',
        recoverable: false,
        cause: err,
      });
    }
    throw err;
  }
  const composed = composedSceneFromIR(ir);
  const scene = createSceneRuntime(composed);
  // P5: resolve the active scene's first camera node once at boot (R3:
  // graphs are static post-raise, so no per-frame DFS).
  const cameraNodeId = findFirstCameraNodeId(scene.graph.roots);
  const cameraNode = cameraNodeId ? scene.graph.find(cameraNodeId) : undefined;

  // --- Assets: manifest synth + preload wired to the kernel bus. -----------
  const assets = createAssetManager();
  assets.init(manifestFromAssetRefs(ir.assets), {
    cdnBase: options.cdnBase,
    fetchImpl: options.fetchImpl,
    capabilities: kernel.capabilities, // P7: capability-aware variant selection
    emit: (payload) => bus.emit('asset:progress', payload),
  });

  const reportError = (err: EngineError): void => bus.emit('engine:error', err);
  const toErr = (cause: unknown, module: string, code: string): EngineError => ({
    module,
    code,
    recoverable: true,
    cause,
  });

  // Preload runs inside the kernel 'loading' phase via a plugin.
  kernel.registerPlugin({
    name: 'lumen:asset-preload',
    version: '0.1.0',
    async init() {
      const results = await assets.preload();
      for (const r of results) {
        if (r.status === 'error') reportError(toErr(r.error, 'assets', 'ASSET_LOAD_FAILED'));
      }
    },
    async dispose() {
      await assets.dispose();
    },
  });

  await kernel.start(); // created → booting → loading → ready → active

  // P4: visibility policy — hidden tabs shed preload + scrub-seek work.
  // (The kernel owns listener registration and re-emits on the typed bus.)
  let pageHidden = false;
  const offVisibility = kernel.on('engine:visibility', ({ state }) => {
    pageHidden = state === 'hidden';
    assets.setPaused(pageHidden);
  });

  const reducedMotion = options.reducedMotion ?? kernel.capabilities.reducedMotion;
  // P1: single owner of reduced-motion behavior. A wire scene default (any
  // a11y entry declaring `motion`) wins; otherwise reduced motion maps to
  // 'reveal' and full motion to 'continuous' (legacy boolean semantics).
  const sceneMotion = ((): MotionMode | undefined => {
    for (const key of Object.keys(ir.a11y).sort()) {
      const m = ir.a11y[key]?.motion;
      if (m === 'continuous' || m === 'reveal' || m === 'static') return m;
    }
    return undefined;
  })();
  const motionPolicy = createMotionPolicy({ reducedMotion, sceneDefault: sceneMotion });
  // Scrub quantization boundaries per track (keyframe t values), cached at boot.
  const scrubBoundaries = new Map<string, readonly number[]>();
  for (const t of ir.tracks) {
    if (t.keyframes.length > 0) scrubBoundaries.set(t.id, t.keyframes.map((k) => k.t));
  }

  // --- Renderer: capability selection + adaptive quality. ------------------
  surface = document.createElement('canvas');
  surface.setAttribute('data-lumen-surface', '');
  surface.style.position = 'absolute';
  surface.style.inset = '0';
  rootElement.appendChild(surface);

  const backend = selectRenderer(kernel.capabilities, options.renderer);
  const renderer = await createRenderer(backend, { surface });

  const surfaceSize = { width: 0, height: 0 };
  const applySize = (): void => {
    surfaceSize.width = rootElement.clientWidth || 0;
    surfaceSize.height = rootElement.clientHeight || 0;
    const dpr = kernel.capabilities.dpr.max;
    if (surfaceSize.width > 0 && surfaceSize.height > 0) {
      renderer.resize(surfaceSize.width, surfaceSize.height, dpr);
    }
  };
  applySize();
  onResize = (): void => applySize();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize);
    // iOS Safari: URL-bar show/hide changes the visual viewport without a
    // window resize — listen to both.
    window.visualViewport?.addEventListener('resize', onResize);
  }

  const quality = new AdaptiveQualityController(
    { budgetMs: kernel.scheduler.budgetMs, maxDpr: kernel.capabilities.dpr.max },
    options.postPasses ?? [],
  );

  // --- Interaction: bindings from IR, navigation onto the bus. -------------
  const interaction = new InteractionManager({
    bindings: ir.bindings,
    reducedMotion,
    motion: motionPolicy,
    ...(ir.tracks.some((t) => t.smoothing !== undefined)
      ? {
          trackSmoothing: Object.fromEntries(
            ir.tracks.filter((t) => t.smoothing !== undefined).map((t) => [t.id, t.smoothing!]),
          ),
        }
      : {}),
    onNavigate: (dir) => bus.emit(dir === 'next' ? 'scene:next' : 'scene:prev', {}),
  });
  interaction.attach(rootElement);

  // --- Scroll scrub: route playback.time bindings to video seekTo(). -------
  const scrubTargets = collectScrubTargets(scene);
  const scrubber = createScrubber({ assets, onError: reportError });

  // --- Frame loop: interaction → drivers → scene evaluate → render. --------
  let elapsed = 0;
  let firstFrameEmitted = false;
  const stats: FrameStats = { cpuMs: 0, gpuMsEstimate: 0, drawCalls: 0, overBudget: false };
  const unregister = kernel.scheduler.register(
    (frame) => {
      const dt = frame.delta / 1000;
      const drivers: DriverMap = interaction.update(dt);
      // P1: the motion policy owns the clock. 'continuous'/'reveal' pass
      // time; 'static' holds t=0. (Legacy: raw `if (!reducedMotion)`.)
      elapsed = motionPolicy.advanceTime(elapsed, dt);

      // Adapter: the interaction layer emits per-track seconds (trackId →
      // scalar); the scene layer resolves playheads per driver kind. Merge:
      // defaults from resolvePlayheads, per-track overrides from the driver map.
      const playheads = resolvePlayheads(scene.tracks, elapsed, {});
      for (const [trackId, value] of Object.entries(drivers)) playheads.set(trackId, value);
      applyBindings(scene.graph, scene.tracks, playheads);
      if (scrubTargets.length > 0 && !pageHidden) {
        // P1: tracks resolving to 'reveal' quantize scrub seeks to their
        // keyframe boundaries (a scroll-scrubbed video no longer frame-seeks
        // under reduced motion). Track overrides are honored via trackMode.
        let scrubHeads = playheads;
        let quantized: Map<string, number> | null = null;
        for (const track of scene.tracks) {
          if (motionPolicy.trackMode(track) !== 'reveal') continue;
          const value = playheads.get(track.id);
          if (value !== undefined) {
            (quantized ??= new Map(playheads)).set(
              track.id,
              motionPolicy.quantizeScrub(value, scrubBoundaries.get(track.id) ?? []),
            );
          }
        }
        if (quantized) scrubHeads = quantized;
        scrubber.update(scrubHeads, scrubTargets);
      }
      scene.graph.updateWorldTransforms();

      const drawList: DrawCall[] = [];
      const visit = (node: SceneNode, ancestorsVisible: boolean): void => {
        const visible = ancestorsVisible && node.visible;
        if (visible) {
          const world = scene.graph.getWorldTransform(node.id);
          if (world) {
            const call = drawCallForNode(node, world, surfaceSize);
            if (call) drawList.push(call);
          }
        }
        for (const child of node.children) visit(child, visible);
      };
      for (const root of scene.graph.roots) visit(root, true);
      drawList.sort((a, b) => a.layer - b.layer);

      // P5: a bound camera node drives frame.camera; camera-less scenes get
      // the byte-identical DEFAULT_CAMERA. Under a reveal/static motion
      // policy the camera track playheads are already snapped by the policy.
      const camWorld = cameraNodeId ? scene.graph.getWorldTransform(cameraNodeId) : undefined;
      const camera: CameraState = resolveCamera({
        world: camWorld,
        node: cameraNode,
        defaultCamera: DEFAULT_CAMERA,
      });

      const renderFrame: RenderFrame = {
        time: elapsed,
        camera,
        drawList,
        post: quality.getLevel().postPasses.map((name) => ({ name })),
        clearColor: [0, 0, 0, 1],
      };
      renderer.renderFrame(renderFrame, stats);

      // P17: after the first real frame, swap SSR poster placeholders for
      // live pixels — but only for nodes that actually made the draw list
      // (hidden/unmounted nodes keep their posters). Emitted exactly once.
      if (!firstFrameEmitted) {
        firstFrameEmitted = true;
        for (const call of drawList) {
          const host = rootElement.querySelector(`[data-node="${call.nodeId}"]`);
          const posters = host?.querySelectorAll('img[data-lumen-poster]');
          posters?.forEach((img) => img.remove());
        }
        bus.emit('render:first-frame', { drawCalls: drawList.length });
      }

      if (quality.update(stats)) {
        const level: QualityLevel = quality.getLevel();
        renderer.setQuality(level);
        bus.emit('render:quality-change', { dprScale: level.dprScale, backend: renderer.backend });
      }
    },
    { priority: 30, phase: 'render' },
  );

  rootElement.dataset.lumenBooted = 'true';

  const engine: LumenEngine = {
    kernel,
    scene,
    renderer,
    assets,
    interaction,
    ir,
    get phase() {
      return kernel.phase;
    },
    get capabilities() {
      return kernel.capabilities;
    },
    on: (event, handler) => kernel.on(event, handler),
    pause: () => kernel.pause(),
    resume: () => kernel.resume(),
    async dispose() {
      unregister();
      offVisibility();
      scrubber.dispose();
      interaction.detach();
      if (typeof window !== 'undefined' && onResize) {
        window.removeEventListener('resize', onResize);
        window.visualViewport?.removeEventListener('resize', onResize);
      }
      renderer.dispose();
      if (surface && surface.parentNode) surface.parentNode.removeChild(surface);
      delete rootElement.dataset.lumenBooted;
      await kernel.dispose(); // disposes plugins (asset manager) in reverse order
    },
  };
  return engine;
  } catch (cause) {
    // Partial boot failure: tear down everything that already started.
    if (typeof window !== 'undefined' && onResize) {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    }
    if (surface && surface.parentNode) surface.parentNode.removeChild(surface);
    await kernel.dispose();
    throw cause;
  }
}

/**
 * Hydrate SSR islands: locate each island anchor in the document and mark it
 * live. Island ids come from `ir.hydration.islands` (DOM anchor ids emitted
 * by codegen). Missing anchors are skipped (non-fatal). Guarded: a no-op
 * resolving immediately when there is no DOM.
 */
export async function hydrateIslands(
  engine: LumenEngine | unknown,
  islands: readonly string[],
): Promise<void> {
  if (typeof document === 'undefined') return;
  // P12: re-apply the a11y wire record during hydration (idempotent with the
  // SSR output in gen-static.ts). Absent entries ⇒ legacy behavior.
  const a11y = (engine as LumenEngine | null)?.ir?.a11y;
  for (const id of islands ?? []) {
    const el = document.getElementById(id);
    if (!el) continue;
    const entry = a11y?.[id];
    if (entry) {
      el.setAttribute('aria-label', entry.label);
      if (entry.summary && el.querySelector('.lumen-visually-hidden') === null) {
        const desc = document.createElement('p');
        desc.className = 'lumen-visually-hidden';
        desc.textContent = entry.summary;
        el.appendChild(desc);
      }
    }
    el.setAttribute('data-lumen-hydrated', '');
    el.dispatchEvent(new CustomEvent('lumen:hydrate', { detail: { engine, island: id } }));
  }
}

/** Visually-hidden but screen-reader-visible inline styles. */
const VISUALLY_HIDDEN: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

/**
 * P12: live-region announcer. Appends one `aria-live="polite"`
 * visually-hidden div to `rootElement` and announces scene transitions by
 * their wire `a11y[sceneId].label`. Scene navigation requests
 * ('scene:next'/'scene:prev') resolve into 'scene:enter' transitions, so
 * that single subscription covers keyboard/semantic navigation; under a
 * P1 reveal/static policy each snap transition is announced as a discrete
 * state change. Returns a dispose function (unsubscribe + node removal).
 * Guarded: a no-op disposer without a DOM.
 */
export function createA11yAnnouncer(
  engine: LumenEngine,
  rootElement: HTMLElement,
): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const region = document.createElement('div');
  region.setAttribute('aria-live', 'polite');
  region.className = 'lumen-visually-hidden';
  Object.assign(region.style, VISUALLY_HIDDEN);
  rootElement.appendChild(region);

  const off = engine.on('scene:enter', ({ sceneId }) => {
    const label = engine.ir.a11y[sceneId]?.label;
    if (label !== undefined) region.textContent = label;
  });

  return () => {
    off();
    region.remove();
  };
}

/** Narrow a bootEngine() result for KernelHandle-only consumers. */
export function asKernelHandle(engine: LumenEngine): KernelHandle {
  return engine.kernel;
}

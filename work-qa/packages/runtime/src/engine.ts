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
  isSceneIR,
  manifestFromAssetRefs,
  type SceneIR,
} from './ir.js';
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

/** Parse/accept a SceneIR document (object or JSON string). */
export function parseSceneIR(input: SceneIR | string | unknown): SceneIR {
  const value = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!isSceneIR(value)) {
    throw new Error(
      `@lumen/runtime: invalid SceneIR document (expected version 1 with site/nodes/tracks/bindings/assets/hydration)`,
    );
  }
  return value;
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
  const ir = parseSceneIR(irInput);

  const kernel = createKernel(options.kernel);
  // From here on, any failure must dispose the kernel (plugins, scheduler,
  // asset handles) and remove a partially appended canvas before rethrowing.
  let surface: HTMLCanvasElement | null = null;
  let onResize: (() => void) | null = null;
  try {
  const bus = kernel.bus;
  const composed = composedSceneFromIR(ir);
  const scene = createSceneRuntime(composed);

  // --- Assets: manifest synth + preload wired to the kernel bus. -----------
  const assets = createAssetManager();
  assets.init(manifestFromAssetRefs(ir.assets), {
    cdnBase: options.cdnBase,
    fetchImpl: options.fetchImpl,
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

  const reducedMotion = options.reducedMotion ?? kernel.capabilities.reducedMotion;

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
    onNavigate: (dir) => bus.emit(dir === 'next' ? 'scene:next' : 'scene:prev', {}),
  });
  interaction.attach(rootElement);

  // --- Scroll scrub: route playback.time bindings to video seekTo(). -------
  const scrubTargets = collectScrubTargets(scene);
  const scrubber = createScrubber({ assets, onError: reportError });

  // --- Frame loop: interaction → drivers → scene evaluate → render. --------
  let elapsed = 0;
  const stats: FrameStats = { cpuMs: 0, gpuMsEstimate: 0, drawCalls: 0, overBudget: false };
  const unregister = kernel.scheduler.register(
    (frame) => {
      const dt = frame.delta / 1000;
      const drivers: DriverMap = interaction.update(dt);
      // Reduced motion: time-driven tracks hold at their first frame; only
      // user-driven (scroll/pointer) tracks advance.
      if (!reducedMotion) elapsed += dt;

      // Adapter: the interaction layer emits per-track seconds (trackId →
      // scalar); the scene layer resolves playheads per driver kind. Merge:
      // defaults from resolvePlayheads, per-track overrides from the driver map.
      const playheads = resolvePlayheads(scene.tracks, elapsed, {});
      for (const [trackId, value] of Object.entries(drivers)) playheads.set(trackId, value);
      applyBindings(scene.graph, scene.tracks, playheads);
      if (scrubTargets.length > 0) scrubber.update(playheads, scrubTargets);
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

      const renderFrame: RenderFrame = {
        time: elapsed,
        camera: DEFAULT_CAMERA,
        drawList,
        post: quality.getLevel().postPasses.map((name) => ({ name })),
        clearColor: [0, 0, 0, 1],
      };
      renderer.renderFrame(renderFrame, stats);

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
  for (const id of islands ?? []) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.setAttribute('data-lumen-hydrated', '');
    el.dispatchEvent(new CustomEvent('lumen:hydrate', { detail: { engine, island: id } }));
  }
}

/** Narrow a bootEngine() result for KernelHandle-only consumers. */
export function asKernelHandle(engine: LumenEngine): KernelHandle {
  return engine.kernel;
}

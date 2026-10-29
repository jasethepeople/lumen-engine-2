/**
 * WebGLRenderer — IRenderer backend backed by Three.js (r160+), loaded lazily
 * via dynamic import so DOM/Canvas2D-only templates never pay the bundle cost.
 *
 * `three` is an OPTIONAL peer dependency. When it is not installed,
 * `WebGLRenderer.create()` throws a typed RenderingError with code
 * 'RENDERER_UNAVAILABLE' which the selector (select.ts) catches to fall back
 * to the next backend in the chain.
 *
 * Draw call payload convention (see README):
 *   { kind: 'mesh', assetId: string, material?: {...}, transform?: { position, rotationQuat, scale } }
 *   { kind: 'video-plane', assetId, scrubbed, transform? }
 */

import type {
  CameraState,
  DrawCall,
  FrameStats,
  IRenderer,
  QualityLevel,
  Quat,
  RenderFrame,
  RenderTargetDesc,
  RenderTargetHandle,
  TextureAsset,
  TextureHandle,
  Vec3,
} from '@lumen/contracts';
import { RenderingError, mintHandle } from './errors.js';

/**
 * Minimal structural view of the three.js module surface this renderer uses.
 * Declared locally so the package typechecks without `three` installed; the
 * real module is verified dynamically at load time.
 */
export interface ThreeLike {
  Scene: new () => ThreeScene;
  PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => ThreeCamera;
  WebGLRenderer: new (opts: { canvas: unknown; antialias?: boolean; alpha?: boolean }) => ThreeGL;
  WebGLRenderTarget: new (width: number, height: number, opts?: { samples?: number; depthBuffer?: boolean }) => ThreeRenderTarget;
  Mesh: new (geometry: unknown, material: unknown) => ThreeObject3D;
  BoxGeometry: new (width?: number, height?: number, depth?: number) => unknown;
  PlaneGeometry: new (width?: number, height?: number) => unknown;
  SphereGeometry: new (radius?: number, widthSegments?: number, heightSegments?: number) => unknown;
  MeshBasicMaterial: new (opts?: Record<string, unknown>) => unknown;
  MeshStandardMaterial: new (opts?: Record<string, unknown>) => unknown;
  Texture: new (image?: unknown) => ThreeTexture;
  Color: new (r: number, g: number, b: number) => unknown;
  Group: new () => ThreeObject3D;
}

export interface ThreeObject3D {
  position: { set(x: number, y: number, z: number): void };
  quaternion: { set(x: number, y: number, z: number, w: number): void };
  scale: { set(x: number, y: number, z: number): void };
  visible: boolean;
  add(child: ThreeObject3D): void;
  remove(child: ThreeObject3D): void;
  dispose?(): void;
}

export interface ThreeScene extends ThreeObject3D {
  background: unknown;
}

export interface ThreeCamera extends ThreeObject3D {
  aspect: number;
  up: { set(x: number, y: number, z: number): void };
  updateProjectionMatrix(): void;
  lookAt(x: number, y: number, z: number): void;
}

export interface ThreeGL {
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: unknown, alpha?: number): void;
  setRenderTarget(target: ThreeRenderTarget | null): void;
  render(scene: ThreeScene, camera: ThreeCamera): void;
  dispose(): void;
  shadowMap?: { enabled: boolean };
}

export interface ThreeRenderTarget {
  setSize(width: number, height: number): void;
  dispose(): void;
}

export interface ThreeTexture {
  needsUpdate: boolean;
  dispose(): void;
}

/** Transform carried by a mesh payload (mirrors contracts Transform). */
export interface MeshTransformPayload {
  position?: Vec3;
  rotationQuat?: Quat;
  scale?: Vec3;
}

export interface MeshDrawPayload {
  kind: 'mesh' | 'video-plane' | 'sprite';
  assetId: string;
  material?: Record<string, number | number[] | string>;
  transform?: MeshTransformPayload;
}

/**
 * Pluggable factory mapping a mesh draw payload to a three Object3D.
 * Hosts (or the scene package) can inject template-specific geometry/material
 * resolution; the default factory builds placeholder primitives by convention.
 */
export type MeshFactory = (payload: MeshDrawPayload, three: ThreeLike) => ThreeObject3D;

/** Default factory: primitive geometry by material 'geometry' hint, else unit box. */
export const defaultMeshFactory: MeshFactory = (payload, three) => {
  const hint = payload.material?.['geometry'];
  let geometry: unknown;
  if (hint === 'plane') geometry = new three.PlaneGeometry(1, 1);
  else if (hint === 'sphere') geometry = new three.SphereGeometry(0.5, 32, 16);
  else geometry = new three.BoxGeometry(1, 1, 1);
  const materialOpts: Record<string, unknown> = {};
  const color = payload.material?.['color'];
  if (typeof color === 'string') materialOpts['color'] = color;
  const opacity = payload.material?.['opacity'];
  if (typeof opacity === 'number' && opacity < 1) {
    materialOpts['opacity'] = opacity;
    materialOpts['transparent'] = true;
  }
  return new three.Mesh(geometry, new three.MeshStandardMaterial(materialOpts));
};

export interface WebGLRendererOptions {
  /** Inject a pre-loaded three module (tests, hosts bundling three themselves). */
  three?: ThreeLike;
  /** Pluggable mesh factory; defaults to defaultMeshFactory. */
  meshFactory?: MeshFactory;
  /** Override the dynamic import specifier (testing). */
  importSpecifier?: string;
}

export class WebGLRenderer implements IRenderer {
  readonly backend = 'webgl2' as const;

  private readonly three: ThreeLike;
  private readonly meshFactory: MeshFactory;
  private gl: ThreeGL | null = null;
  private scene: ThreeScene | null = null;
  private onContextLost: ((e: unknown) => void) | null = null;
  private onContextRestored: (() => void) | null = null;
  private contextSurface: {
    removeEventListener?: (type: string, fn: (e: unknown) => void) => void;
  } | null = null;
  private camera: ThreeCamera | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private quality: QualityLevel = { dprScale: 1, msaa: 4, postPasses: [], shadowMapSize: 1024 };
  private readonly objects = new Map<string, ThreeObject3D>();
  private readonly textures = new Map<TextureHandle, ThreeTexture>();
  private readonly targets = new Map<RenderTargetHandle, ThreeRenderTarget>();

  /**
   * Synchronous construction requires an already-loaded three module and
   * throws a typed error when absent — this is what select.ts catches.
   */
  constructor(opts: WebGLRendererOptions = {}) {
    if (opts.three === undefined) {
      throw new RenderingError(
        'RENDERER_UNAVAILABLE',
        'WebGLRenderer: three.js module not provided. Use `await WebGLRenderer.create()` for lazy loading, or install the optional peer dependency "three".',
        { backend: 'webgl2', recoverable: true },
      );
    }
    this.three = opts.three;
    this.meshFactory = opts.meshFactory ?? defaultMeshFactory;
  }

  /** Lazy factory: dynamically imports three, throwing a typed error when absent. */
  static async create(opts: WebGLRendererOptions = {}): Promise<WebGLRenderer> {
    let three: ThreeLike;
    if (opts.three !== undefined) {
      three = opts.three;
    } else {
      // Non-literal specifier keeps the import lazy AND out of the type
      // checker / bundler graph when three is not installed.
      const specifier = opts.importSpecifier ?? 'three';
      try {
        three = (await import(specifier)) as unknown as ThreeLike;
      } catch (cause) {
        throw new RenderingError(
          'RENDERER_UNAVAILABLE',
          'WebGLRenderer: optional peer dependency "three" (>=0.160) is not installed; falling back to a lower-fidelity backend.',
          { backend: 'webgl2', recoverable: true, cause },
        );
      }
    }
    return new WebGLRenderer({ ...opts, three });
  }

  async init(surface: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
    try {
      this.gl = new this.three.WebGLRenderer({
        canvas: surface,
        antialias: this.quality.msaa > 0,
        alpha: true,
      });
    } catch (cause) {
      throw new RenderingError('RENDERER_UNAVAILABLE', 'WebGL2 context creation failed.', {
        backend: 'webgl2',
        recoverable: true,
        cause,
      });
    }
    this.scene = new this.three.Scene();
    this.camera = new this.three.PerspectiveCamera(60, 1, 0.1, 1000);
    this.applySize();

    // GPU context loss (mobile GPU pressure): preventDefault keeps the
    // context restorable; on restore, re-apply size and flag textures for
    // re-upload so the canvas does not stay black.
    const surfaceEl = surface as unknown as {
      addEventListener?: (type: string, fn: (e: unknown) => void) => void;
      removeEventListener?: (type: string, fn: (e: unknown) => void) => void;
    };
    if (typeof surfaceEl.addEventListener === 'function') {
      this.onContextLost = (e: unknown) => {
        (e as { preventDefault?: () => void }).preventDefault?.();
      };
      this.onContextRestored = () => {
        this.applySize();
        for (const tex of this.textures.values()) {
          (tex as { needsUpdate?: boolean }).needsUpdate = true;
        }
      };
      surfaceEl.addEventListener('webglcontextlost', this.onContextLost);
      surfaceEl.addEventListener('webglcontextrestored', this.onContextRestored);
      this.contextSurface = surfaceEl;
    }
  }

  createTarget(desc: RenderTargetDesc): RenderTargetHandle {
    if (desc.width <= 0 || desc.height <= 0) {
      throw new RenderingError('INVALID_TARGET', `RenderTarget dimensions must be positive, got ${desc.width}x${desc.height}.`, {
        backend: 'webgl2',
        recoverable: false,
      });
    }
    const target = new this.three.WebGLRenderTarget(desc.width, desc.height, {
      samples: desc.samples ?? 0,
      depthBuffer: desc.depth ?? true,
    });
    const handle = mintHandle<RenderTargetHandle>('gl-target');
    this.targets.set(handle, target);
    return handle;
  }

  uploadTexture(asset: TextureAsset): TextureHandle {
    const tex = new this.three.Texture(asset.data instanceof ArrayBuffer ? undefined : asset.data);
    tex.needsUpdate = true;
    const handle = mintHandle<TextureHandle>('gl-tex');
    this.textures.set(handle, tex);
    return handle;
  }

  renderFrame(frame: RenderFrame, stats: FrameStats): void {
    if (this.gl === null || this.scene === null || this.camera === null) {
      throw new RenderingError('RENDERER_NOT_INITIALIZED', 'WebGLRenderer.renderFrame called before init().', {
        backend: 'webgl2',
      });
    }
    const start = now();
    const gl = this.gl;
    const scene = this.scene;

    this.applyCamera(frame.camera);
    const [r, g, b, a] = frame.clearColor;
    gl.setClearColor(new this.three.Color(r, g, b), a);

    const seen = new Set<string>();
    let drawCalls = 0;
    for (const call of frame.drawList) {
      const payload = call.payload as MeshDrawPayload | undefined;
      if (payload === undefined || (payload.kind !== 'mesh' && payload.kind !== 'video-plane' && payload.kind !== 'sprite')) {
        continue;
      }
      seen.add(call.nodeId);
      let obj = this.objects.get(call.nodeId);
      if (obj === undefined) {
        obj = this.meshFactory(payload, this.three);
        this.objects.set(call.nodeId, obj);
        scene.add(obj);
      }
      if (payload.transform !== undefined) {
        const t = payload.transform;
        if (t.position !== undefined) obj.position.set(...t.position);
        if (t.rotationQuat !== undefined) obj.quaternion.set(...t.rotationQuat);
        if (t.scale !== undefined) obj.scale.set(...t.scale);
      }
      obj.visible = true;
      drawCalls += 1;
    }
    // Hide stale objects; keep them for reuse (pooling at the scene level).
    for (const [id, obj] of this.objects) {
      if (!seen.has(id)) obj.visible = false;
    }

    const target = frame.drawList.find((c) => c.target !== undefined)?.target;
    gl.setRenderTarget(target !== undefined ? (this.targets.get(target) ?? null) : null);
    gl.render(scene, this.camera);
    gl.setRenderTarget(null);

    const cpuMs = now() - start;
    stats.cpuMs = cpuMs;
    stats.gpuMsEstimate = cpuMs * 0.6; // heuristic until EXT_disjoint_timer_query is wired
    stats.drawCalls = drawCalls;
    stats.overBudget = cpuMs > 16.7;
  }

  private applyCamera(state: CameraState): void {
    const cam = this.camera;
    if (cam === null) return;
    cam.position.set(...state.position);
    cam.up.set(...state.up);
    cam.lookAt(...state.target);
    if (cam.aspect !== this.width / this.height) {
      cam.aspect = this.width / this.height;
      cam.updateProjectionMatrix();
    }
  }

  setQuality(q: QualityLevel): void {
    this.quality = { ...q, postPasses: [...q.postPasses] };
    this.applySize();
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    this.applySize();
  }

  private applySize(): void {
    this.gl?.setPixelRatio(this.dpr * this.quality.dprScale);
    this.gl?.setSize(this.width, this.height, false);
  }

  dispose(): void {
    if (this.contextSurface && this.onContextLost && this.onContextRestored) {
      this.contextSurface.removeEventListener?.('webglcontextlost', this.onContextLost);
      this.contextSurface.removeEventListener?.('webglcontextrestored', this.onContextRestored);
    }
    this.contextSurface = null;
    this.onContextLost = null;
    this.onContextRestored = null;
    for (const t of this.textures.values()) t.dispose();
    for (const t of this.targets.values()) t.dispose();
    this.textures.clear();
    this.targets.clear();
    // Release pooled GPU resources held by spawned meshes (defaultMeshFactory
    // creates a fresh Box/Plane/SphereGeometry + material per object).
    for (const obj of this.objects.values()) {
      const mesh = obj as unknown as {
        geometry?: { dispose?: () => void };
        material?: { dispose?: () => void } | Array<{ dispose?: () => void }>;
      };
      mesh.geometry?.dispose?.();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose?.();
      } else {
        material?.dispose?.();
      }
    }
    this.objects.clear();
    this.gl?.dispose();
    this.gl = null;
    this.scene = null;
    this.camera = null;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

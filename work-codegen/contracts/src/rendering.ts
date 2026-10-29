/**
 * @lumen/contracts — rendering domain.
 * Renderer backend abstraction, frame description, camera state,
 * render targets, textures, and adaptive quality levels.
 */

import type { Vec3 } from './scene.js';

/** Available render backends, in rising fidelity order. Fallback chain: webgpu → webgl2 → canvas2d → dom. */
export type RendererBackend = 'dom' | 'canvas2d' | 'webgl2' | 'webgpu';

/** Opaque handle to a GPU/host texture returned by IRenderer.uploadTexture. */
export type TextureHandle = string & { readonly __brand: 'TextureHandle' };

/** Opaque handle to a created render target. */
export type RenderTargetHandle = string & { readonly __brand: 'RenderTargetHandle' };

/** Camera state for a single frame, in world space. */
export interface CameraState {
  /** World-space camera position. */
  position: Vec3;
  /** World-space look-at target. */
  target: Vec3;
  /** Up vector (usually [0, 1, 0]). */
  up: Vec3;
  /** Vertical field of view in degrees (perspective cameras). */
  fov: number;
  /** Near clipping plane distance. */
  near: number;
  /** Far clipping plane distance. */
  far: number;
}

/** Description of an offscreen render target to allocate. */
export interface RenderTargetDesc {
  /** Width in physical pixels. */
  width: number;
  /** Height in physical pixels. */
  height: number;
  /** MSAA sample count. */
  samples?: 0 | 2 | 4 | 8;
  /** Allocate a depth/stencil attachment. */
  depth?: boolean;
  /** Optional debug label. */
  label?: string;
}

/** A single resolved draw call in a RenderFrame draw list. */
export interface DrawCall {
  /** SceneNode.id this draw call was resolved from. */
  nodeId: string;
  /** Optional texture bound for this draw. */
  texture?: TextureHandle;
  /** Optional override render target; default is the primary surface. */
  target?: RenderTargetHandle;
  /** Render-layer ordering key (SceneNode.layer). */
  layer: number;
  /** Backend-specific payload (mesh id, DOM mutation descriptor, blit rect, ...). */
  payload?: Record<string, unknown>;
}

/** A post-processing pass applied after the draw list. */
export interface PostProcessPass {
  /** Pass name, e.g. 'bloom' | 'grain' | 'vignette'. */
  name: string;
  /** Pass-specific parameters. */
  params?: Record<string, number | number[] | string>;
}

/** A fully-resolved frame handed from the scene graph to the renderer. */
export interface RenderFrame {
  /** Timeline time in seconds this frame represents. */
  time: number;
  /** Camera state for this frame. */
  camera: CameraState;
  /** Ordered draw calls. */
  drawList: DrawCall[];
  /** Post-processing passes, e.g. bloom, grain, vignette. */
  post: PostProcessPass[];
  /** RGBA clear color. */
  clearColor: [number, number, number, number];
}

/** Adaptive quality directives applied by the renderer. */
export interface QualityLevel {
  /** Render resolution scale relative to devicePixelRatio, 0.5–2.0. */
  dprScale: number;
  /** MSAA sample count; 0 disables. */
  msaa: 0 | 2 | 4 | 8;
  /** Names of post-processing passes currently enabled. */
  postPasses: string[];
  /** Shadow map resolution in pixels (3D templates). */
  shadowMapSize?: number;
}

/** Per-frame render statistics reported back to the kernel scheduler. */
export interface FrameStats {
  /** CPU time spent rendering this frame, milliseconds. */
  cpuMs: number;
  /** Estimated GPU time, milliseconds. */
  gpuMsEstimate: number;
  /** Number of draw calls issued. */
  drawCalls: number;
  /** True when the frame exceeded its budget. */
  overBudget: boolean;
}

/** Decoded texture data accepted by IRenderer.uploadTexture. */
export interface TextureAsset {
  /** Pixel width. */
  width: number;
  /** Pixel height. */
  height: number;
  /** Decoded pixels (browser) or raw bytes (headless/build). */
  data: ImageBitmap | ArrayBufferView;
  /** Optional debug label. */
  label?: string;
}

/** Unified renderer interface implemented by all four backends. */
export interface IRenderer {
  /** Backend this instance implements. */
  readonly backend: RendererBackend;
  /** Initialize against a canvas surface (main thread or worker). */
  init(surface: HTMLCanvasElement | OffscreenCanvas): Promise<void>;
  /** Allocate an offscreen render target. */
  createTarget(desc: RenderTargetDesc): RenderTargetHandle;
  /** Upload decoded texture data; returns an opaque handle. */
  uploadTexture(asset: TextureAsset): TextureHandle;
  /** Render one resolved frame; per-frame stats are written into `stats`. */
  renderFrame(frame: RenderFrame, stats: FrameStats): void;
  /** Apply adaptive quality directives. */
  setQuality(q: QualityLevel): void;
  /** Notify the renderer of a surface size change (physical pixels = css * dpr). */
  resize(width: number, height: number, dpr: number): void;
  /** Release all GPU/host resources. */
  dispose(): void;
}

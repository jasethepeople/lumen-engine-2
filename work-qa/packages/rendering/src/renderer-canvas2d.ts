/**
 * Canvas2DRenderer — IRenderer backend drawing image/sprite primitives and
 * text nodes into a 2D canvas. Dependency-free; works against either an
 * HTMLCanvasElement or an OffscreenCanvas (worker path).
 *
 * Draw call payload convention (see README):
 *   { kind: 'image', texture?: TextureHandle, rect: {x,y,width,height}, opacity? }
 *   { kind: 'shape', shape: 'rect'|'circle', rect|center+radius, fill, opacity? }
 *   { kind: 'text', text: string, x, y, font?, fill?, align?, baseline?, maxWidth? }
 *   { kind: 'sprite', texture, frame: {x,y,width,height}, rect, opacity? }  // lottie-ish frame blit
 */

import type {
  DrawCall,
  FrameStats,
  IRenderer,
  QualityLevel,
  RenderFrame,
  RenderTargetDesc,
  RenderTargetHandle,
  TextureAsset,
  TextureHandle,
} from '@lumen/contracts';
import { RenderingError, hasDOM, hasOffscreenCanvas, mintHandle } from './errors.js';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImagePayload {
  kind: 'image' | 'sprite';
  texture?: TextureHandle;
  frame?: Rect;
  rect: Rect;
  opacity?: number;
}

interface ShapePayload {
  kind: 'shape';
  shape: 'rect' | 'circle';
  rect?: Rect;
  center?: [number, number];
  radius?: number;
  fill: string;
  opacity?: number;
}

interface TextPayload {
  kind: 'text';
  text: string;
  x: number;
  y: number;
  font?: string;
  fill?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  maxWidth?: number;
  opacity?: number;
}

type CanvasPayload = ImagePayload | ShapePayload | TextPayload;

interface CanvasTarget {
  canvas: AnyCanvas;
  ctx: AnyContext2D;
  desc: RenderTargetDesc;
}

/** Create a canvas of the given size, preferring OffscreenCanvas (unit-testable guard). */
export function createCanvas(width: number, height: number): AnyCanvas {
  if (hasOffscreenCanvas()) {
    return new OffscreenCanvas(width, height);
  }
  if (hasDOM()) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  throw new RenderingError('RENDERER_UNAVAILABLE', 'No canvas implementation available (need DOM or OffscreenCanvas).', {
    backend: 'canvas2d',
  });
}

/** Clamp a DPR scale into [0.5, 2.0] per the QualityLevel contract. */
export function clampDprScale(scale: number): number {
  return Math.min(2, Math.max(0.5, scale));
}

export class Canvas2DRenderer implements IRenderer {
  readonly backend = 'canvas2d' as const;

  private canvas: AnyCanvas | null = null;
  private ctx: AnyContext2D | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private quality: QualityLevel = { dprScale: 1, msaa: 0, postPasses: [] };
  private readonly textures = new Map<TextureHandle, TextureAsset>();
  private readonly targets = new Map<RenderTargetHandle, CanvasTarget>();

  async init(surface: AnyCanvas): Promise<void> {
    const ctx = surface.getContext('2d') as AnyContext2D | null;
    if (ctx === null) {
      throw new RenderingError('RENDERER_UNAVAILABLE', 'Failed to acquire a 2D context from the surface.', {
        backend: 'canvas2d',
        recoverable: true,
      });
    }
    this.canvas = surface;
    this.ctx = ctx;
  }

  createTarget(desc: RenderTargetDesc): RenderTargetHandle {
    if (desc.width <= 0 || desc.height <= 0) {
      throw new RenderingError('INVALID_TARGET', `RenderTarget dimensions must be positive, got ${desc.width}x${desc.height}.`, {
        backend: 'canvas2d',
        recoverable: false,
      });
    }
    const canvas = createCanvas(desc.width, desc.height);
    const ctx = canvas.getContext('2d') as AnyContext2D | null;
    if (ctx === null) {
      throw new RenderingError('INVALID_TARGET', 'Could not acquire a 2D context for the render target.', {
        backend: 'canvas2d',
        recoverable: false,
      });
    }
    const handle = mintHandle<RenderTargetHandle>('c2d-target');
    this.targets.set(handle, { canvas, ctx, desc });
    return handle;
  }

  uploadTexture(asset: TextureAsset): TextureHandle {
    const handle = mintHandle<TextureHandle>('c2d-tex');
    this.textures.set(handle, asset);
    return handle;
  }

  renderFrame(frame: RenderFrame, stats: FrameStats): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (ctx === null || canvas === null) {
      throw new RenderingError('RENDERER_NOT_INITIALIZED', 'Canvas2DRenderer.renderFrame called before init().', {
        backend: 'canvas2d',
      });
    }
    const start = now();

    const [r, g, b, a] = frame.clearColor;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (a > 0) {
      ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.restore();

    // Scale CSS-pixel draw coordinates into physical pixels.
    const scale = this.dpr * this.quality.dprScale;
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    let drawCalls = 0;
    const ordered = [...frame.drawList].sort((x, y) => x.layer - y.layer);
    for (const call of ordered) {
      const targetCtx = call.target !== undefined ? this.targets.get(call.target)?.ctx : ctx;
      if (targetCtx === undefined) continue;
      if (this.drawCall(targetCtx, call)) drawCalls += 1;
    }
    ctx.restore();

    const cpuMs = now() - start;
    stats.cpuMs = cpuMs;
    stats.gpuMsEstimate = 0;
    stats.drawCalls = drawCalls;
    stats.overBudget = cpuMs > 16.7;
  }

  private drawCall(ctx: AnyContext2D, call: DrawCall): boolean {
    const p = call.payload as CanvasPayload | undefined;
    if (p === undefined || p === null) return false;
    const opacity = 'opacity' in p && typeof p.opacity === 'number' ? p.opacity : 1;
    ctx.save();
    ctx.globalAlpha = opacity;

    let drew = false;
    switch (p.kind) {
      case 'image':
      case 'sprite': {
        const source = this.resolveImageSource(p, call);
        if (source !== null) {
          if (p.kind === 'sprite' && p.frame !== undefined) {
            ctx.drawImage(
              source,
              p.frame.x, p.frame.y, p.frame.width, p.frame.height,
              p.rect.x, p.rect.y, p.rect.width, p.rect.height,
            );
          } else {
            ctx.drawImage(source, p.rect.x, p.rect.y, p.rect.width, p.rect.height);
          }
          drew = true;
        }
        break;
      }
      case 'shape': {
        ctx.fillStyle = p.fill;
        if (p.shape === 'rect' && p.rect !== undefined) {
          ctx.fillRect(p.rect.x, p.rect.y, p.rect.width, p.rect.height);
          drew = true;
        } else if (p.shape === 'circle' && p.center !== undefined && p.radius !== undefined) {
          ctx.beginPath();
          ctx.arc(p.center[0], p.center[1], p.radius, 0, Math.PI * 2);
          ctx.fill();
          drew = true;
        }
        break;
      }
      case 'text': {
        if (p.font !== undefined) ctx.font = p.font;
        if (p.fill !== undefined) ctx.fillStyle = p.fill;
        if (p.align !== undefined) ctx.textAlign = p.align;
        if (p.baseline !== undefined) ctx.textBaseline = p.baseline;
        if (p.maxWidth !== undefined) ctx.fillText(p.text, p.x, p.y, p.maxWidth);
        else ctx.fillText(p.text, p.x, p.y);
        drew = true;
        break;
      }
    }
    ctx.restore();
    return drew;
  }

  private resolveImageSource(p: ImagePayload, call: DrawCall): CanvasImageSource | null {
    const texHandle = p.texture ?? call.texture;
    if (texHandle === undefined) return null;
    const asset = this.textures.get(texHandle);
    if (asset === undefined) return null;
    // Only ImageBitmap (browser-decoded) can be drawn directly; raw byte
    // buffers require the asset pipeline to decode them first.
    if (typeof ImageBitmap !== 'undefined' && asset.data instanceof ImageBitmap) {
      return asset.data;
    }
    return null;
  }

  setQuality(q: QualityLevel): void {
    const next = { ...q, dprScale: clampDprScale(q.dprScale), postPasses: [...q.postPasses] };
    const changed = next.dprScale !== this.quality.dprScale;
    this.quality = next;
    if (changed) this.applyBackingSize();
  }

  resize(width: number, height: number, dpr: number): void {
    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = dpr;
    this.applyBackingSize();
  }

  private applyBackingSize(): void {
    if (this.canvas === null) return;
    const scale = this.dpr * this.quality.dprScale;
    this.canvas.width = Math.max(1, Math.round(this.cssWidth * scale));
    this.canvas.height = Math.max(1, Math.round(this.cssHeight * scale));
  }

  dispose(): void {
    this.textures.clear();
    this.targets.clear();
    this.canvas = null;
    this.ctx = null;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

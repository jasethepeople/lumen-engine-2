/**
 * DomRenderer — IRenderer backend that maps resolved DrawCalls carrying
 * `dom`/`video` payloads onto absolutely-positioned DOM elements composited
 * with CSS transforms.
 *
 * Browser-only: importing this module in Node is safe (no top-level DOM
 * access), but `init()` throws a typed RenderingError without a document.
 *
 * Draw call payload convention (payload is opaque in the contracts; this is
 * the DomRenderer's decoding, see README):
 *   {
 *     kind: 'dom' | 'video',
 *     html?: string,            // dom: inner HTML (set once, then reused)
 *     assetId?: string,         // video: resolved media URL by the host
 *     rect: { x, y, width, height },   // CSS pixels, top-left origin
 *     opacity?: number,         // 0..1, default 1
 *     transform?: string,       // extra CSS transform appended after translate
 *     visible?: boolean,        // default true
 *   }
 */
import { RenderingError, hasDOM, mintHandle } from './errors.js';
/** Minimal, pure pooling math extracted for unit testing. */
export class ElementPool {
    active = new Map();
    free = [];
    factory;
    reset;
    /** Counters exposed for tests/instrumentation. */
    created = 0;
    reused = 0;
    culled = 0;
    constructor(factory, reset = () => undefined) {
        this.factory = factory;
        this.reset = reset;
    }
    /** Acquire an element bound to `id`, reusing a freed element when possible. */
    acquire(id) {
        const existing = this.active.get(id);
        if (existing !== undefined)
            return { el: existing, reused: true };
        const pooled = this.free.pop();
        if (pooled !== undefined) {
            this.reused += 1;
            this.active.set(id, pooled);
            return { el: pooled, reused: true };
        }
        this.created += 1;
        const el = this.factory();
        this.active.set(id, el);
        return { el, reused: false };
    }
    /** Release every binding not present in `keep`; returns released elements to the freelist. */
    retain(keep) {
        for (const [id, el] of this.active) {
            if (!keep.has(id)) {
                this.active.delete(id);
                this.reset(el);
                this.free.push(el);
            }
        }
    }
    /** Hide (but keep bound) the element for a culled node. */
    markCulled() {
        this.culled += 1;
    }
    get activeCount() {
        return this.active.size;
    }
    get freeCount() {
        return this.free.length;
    }
    clear() {
        this.active.clear();
        this.free.length = 0;
        this.created = 0;
        this.reused = 0;
        this.culled = 0;
    }
}
/** Pure viewport-intersection test used for visibility culling (unit-testable). */
export function intersectsViewport(rect, viewportWidth, viewportHeight) {
    return (rect.width > 0 &&
        rect.height > 0 &&
        rect.x < viewportWidth &&
        rect.y < viewportHeight &&
        rect.x + rect.width > 0 &&
        rect.y + rect.height > 0);
}
export class DomRenderer {
    backend = 'dom';
    root = null;
    pool = null;
    /** P11 pooled stacking contexts: lazily-created group divs keyed by name. */
    layerGroups = new Map();
    width = 0;
    height = 0;
    dpr = 1;
    quality = { dprScale: 1, msaa: 0, postPasses: [] };
    textures = new Map();
    /** Constructing is safe anywhere; init() enforces the DOM requirement. */
    constructor() { }
    async init(surface) {
        if (!hasDOM()) {
            throw new RenderingError('RENDERER_UNAVAILABLE', 'DomRenderer requires a DOM document (browser main thread).', {
                backend: 'dom',
                recoverable: true,
            });
        }
        const host = surface instanceof HTMLElement ? surface : null;
        // The contract surface is a canvas; the DOM layer is a sibling overlay so
        // canvas-rendered layers and DOM layers can stack. We create an overlay
        // rooted at the canvas' parent, falling back to document.body.
        const parent = host?.parentElement ?? document.body;
        const root = document.createElement('div');
        root.dataset.lumenRenderer = 'dom';
        Object.assign(root.style, {
            position: 'absolute',
            inset: '0',
            overflow: 'hidden',
            pointerEvents: 'none',
            transformOrigin: '0 0',
        });
        parent.appendChild(root);
        this.root = root;
        this.pool = new ElementPool(() => {
            const el = document.createElement('div');
            Object.assign(el.style, {
                position: 'absolute',
                left: '0',
                top: '0',
                willChange: 'transform, opacity',
                pointerEvents: 'auto',
            });
            return { el, nodeId: '', htmlCache: null, lastCss: '' };
        }, (p) => {
            p.nodeId = '';
            p.htmlCache = null;
            p.lastCss = '';
            p.el.style.display = 'none';
            if (p.el.parentElement !== null)
                p.el.parentElement.removeChild(p.el);
        });
    }
    /**
     * P11: return (creating lazily) the stacking-context div for a layerGroup.
     * The group's z-index tracks the minimum layer seen for the group so
     * groups order as a unit beneath/above other groups and ungrouped elements
     * keep their global layer z-index.
     */
    groupDiv(name, layer) {
        const root = this.root;
        if (root === null)
            throw new RenderingError('RENDERER_NOT_INITIALIZED', 'DomRenderer used before init().', { backend: 'dom' });
        let div = this.layerGroups.get(name);
        if (div === undefined) {
            div = document.createElement('div');
            div.dataset.layerGroup = name;
            Object.assign(div.style, {
                position: 'absolute',
                inset: '0',
                pointerEvents: 'none',
                zIndex: String(layer),
            });
            root.appendChild(div);
            this.layerGroups.set(name, div);
        }
        else {
            const current = Number(div.style.zIndex);
            if (!Number.isNaN(current) && layer < current)
                div.style.zIndex = String(layer);
        }
        return div;
    }
    createTarget(_desc) {
        // The DOM backend composites through the browser; offscreen targets are
        // no-ops represented by handles so caller code stays backend-agnostic.
        return mintHandle('dom-target');
    }
    uploadTexture(asset) {
        const handle = mintHandle('dom-tex');
        this.textures.set(handle, asset);
        return handle;
    }
    renderFrame(frame, stats) {
        const root = this.root;
        const pool = this.pool;
        if (root === null || pool === null) {
            throw new RenderingError('RENDERER_NOT_INITIALIZED', 'DomRenderer.renderFrame called before init().', { backend: 'dom' });
        }
        const start = now();
        const seen = new Set();
        let drawCalls = 0;
        let culled = 0;
        for (const call of frame.drawList) {
            const payload = readPayload(call);
            if (payload === null)
                continue; // not a DOM draw call; another layer owns it
            seen.add(call.nodeId);
            const rect = payload.rect ?? { x: 0, y: 0, width: 0, height: 0 };
            const visible = payload.visible !== false && intersectsViewport(rect, this.width, this.height);
            const { el: pooled } = pool.acquire(call.nodeId);
            const el = pooled.el;
            if (!visible) {
                if (el.style.display !== 'none')
                    el.style.display = 'none';
                pool.markCulled();
                culled += 1;
                continue;
            }
            if (payload.kind === 'dom' && typeof payload.html === 'string' && payload.html !== pooled.htmlCache) {
                el.innerHTML = payload.html;
                pooled.htmlCache = payload.html;
            }
            const opacity = payload.opacity ?? 1;
            const css = `${rect.x}|${rect.y}|${rect.width}|${rect.height}|${opacity}|${payload.transform ?? ''}|${call.layer}`;
            if (css !== pooled.lastCss) {
                pooled.lastCss = css;
                el.style.display = '';
                el.style.zIndex = String(call.layer);
                el.style.opacity = String(opacity);
                el.style.width = `${rect.width}px`;
                el.style.height = `${rect.height}px`;
                el.style.transform =
                    `translate3d(${rect.x}px, ${rect.y}px, 0)` + (payload.transform ? ` ${payload.transform}` : '');
            }
            // P11: grouped payloads parent into their stacking-context group div
            // (zIndex becomes group-relative); ungrouped append to root as today.
            const parentEl = payload.layerGroup !== undefined ? this.groupDiv(payload.layerGroup, call.layer) : root;
            if (el.parentElement !== parentEl)
                parentEl.appendChild(el);
            drawCalls += 1;
        }
        pool.retain(seen);
        const cpuMs = now() - start;
        stats.cpuMs = cpuMs;
        stats.gpuMsEstimate = 0; // compositor work is not directly measurable
        stats.drawCalls = drawCalls;
        stats.overBudget = cpuMs > 16.7;
        void culled;
    }
    setQuality(q) {
        this.quality = { ...q, postPasses: [...q.postPasses] };
        // DPR scaling is a pure resolution concern for canvas/GPU backends; for
        // DOM we re-apply sizing so the host can re-layout if it scales the stage.
        if (this.root !== null && this.width > 0) {
            this.root.style.width = `${this.width}px`;
            this.root.style.height = `${this.height}px`;
        }
    }
    resize(width, height, dpr) {
        this.width = width;
        this.height = height;
        this.dpr = dpr;
        if (this.root !== null) {
            this.root.style.width = `${width}px`;
            this.root.style.height = `${height}px`;
        }
    }
    dispose() {
        this.pool?.clear();
        this.pool = null;
        this.root?.remove();
        this.root = null;
        this.textures.clear();
    }
}
function readPayload(call) {
    const p = call.payload;
    if (p === undefined || p === null)
        return null;
    const kind = p['kind'];
    if (kind !== 'dom' && kind !== 'video')
        return null;
    return p;
}
function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

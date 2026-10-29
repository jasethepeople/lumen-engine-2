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
import { RenderingError, mintHandle } from './errors.js';
/** Default factory: primitive geometry by material 'geometry' hint, else unit box. */
export const defaultMeshFactory = (payload, three) => {
    const hint = payload.material?.['geometry'];
    let geometry;
    if (hint === 'plane')
        geometry = new three.PlaneGeometry(1, 1);
    else if (hint === 'sphere')
        geometry = new three.SphereGeometry(0.5, 32, 16);
    else
        geometry = new three.BoxGeometry(1, 1, 1);
    const materialOpts = {};
    const color = payload.material?.['color'];
    if (typeof color === 'string')
        materialOpts['color'] = color;
    const opacity = payload.material?.['opacity'];
    if (typeof opacity === 'number' && opacity < 1) {
        materialOpts['opacity'] = opacity;
        materialOpts['transparent'] = true;
    }
    return new three.Mesh(geometry, new three.MeshStandardMaterial(materialOpts));
};
export class WebGLRenderer {
    backend = 'webgl2';
    three;
    meshFactory;
    gl = null;
    scene = null;
    onContextLost = null;
    onContextRestored = null;
    contextSurface = null;
    camera = null;
    width = 1;
    height = 1;
    dpr = 1;
    quality = { dprScale: 1, msaa: 4, postPasses: [], shadowMapSize: 1024 };
    objects = new Map();
    textures = new Map();
    targets = new Map();
    /**
     * Synchronous construction requires an already-loaded three module and
     * throws a typed error when absent — this is what select.ts catches.
     */
    constructor(opts = {}) {
        if (opts.three === undefined) {
            throw new RenderingError('RENDERER_UNAVAILABLE', 'WebGLRenderer: three.js module not provided. Use `await WebGLRenderer.create()` for lazy loading, or install the optional peer dependency "three".', { backend: 'webgl2', recoverable: true });
        }
        this.three = opts.three;
        this.meshFactory = opts.meshFactory ?? defaultMeshFactory;
    }
    /** Lazy factory: dynamically imports three, throwing a typed error when absent. */
    static async create(opts = {}) {
        let three;
        if (opts.three !== undefined) {
            three = opts.three;
        }
        else {
            // Non-literal specifier keeps the import lazy AND out of the type
            // checker / bundler graph when three is not installed.
            const specifier = opts.importSpecifier ?? 'three';
            try {
                three = (await import(specifier));
            }
            catch (cause) {
                throw new RenderingError('RENDERER_UNAVAILABLE', 'WebGLRenderer: optional peer dependency "three" (>=0.160) is not installed; falling back to a lower-fidelity backend.', { backend: 'webgl2', recoverable: true, cause });
            }
        }
        return new WebGLRenderer({ ...opts, three });
    }
    async init(surface) {
        try {
            this.gl = new this.three.WebGLRenderer({
                canvas: surface,
                antialias: this.quality.msaa > 0,
                alpha: true,
            });
        }
        catch (cause) {
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
        const surfaceEl = surface;
        if (typeof surfaceEl.addEventListener === 'function') {
            this.onContextLost = (e) => {
                e.preventDefault?.();
            };
            this.onContextRestored = () => {
                this.applySize();
                for (const tex of this.textures.values()) {
                    tex.needsUpdate = true;
                }
            };
            surfaceEl.addEventListener('webglcontextlost', this.onContextLost);
            surfaceEl.addEventListener('webglcontextrestored', this.onContextRestored);
            this.contextSurface = surfaceEl;
        }
    }
    createTarget(desc) {
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
        const handle = mintHandle('gl-target');
        this.targets.set(handle, target);
        return handle;
    }
    uploadTexture(asset) {
        const tex = new this.three.Texture(asset.data instanceof ArrayBuffer ? undefined : asset.data);
        tex.needsUpdate = true;
        const handle = mintHandle('gl-tex');
        this.textures.set(handle, tex);
        return handle;
    }
    renderFrame(frame, stats) {
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
        const seen = new Set();
        let drawCalls = 0;
        for (const call of frame.drawList) {
            const payload = call.payload;
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
                if (t.position !== undefined)
                    obj.position.set(...t.position);
                if (t.rotationQuat !== undefined)
                    obj.quaternion.set(...t.rotationQuat);
                if (t.scale !== undefined)
                    obj.scale.set(...t.scale);
            }
            obj.visible = true;
            drawCalls += 1;
        }
        // Hide stale objects; keep them for reuse (pooling at the scene level).
        for (const [id, obj] of this.objects) {
            if (!seen.has(id))
                obj.visible = false;
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
    applyCamera(state) {
        const cam = this.camera;
        if (cam === null)
            return;
        cam.position.set(...state.position);
        cam.up.set(...state.up);
        cam.lookAt(...state.target);
        if (cam.aspect !== this.width / this.height) {
            cam.aspect = this.width / this.height;
            cam.updateProjectionMatrix();
        }
    }
    setQuality(q) {
        this.quality = { ...q, postPasses: [...q.postPasses] };
        this.applySize();
    }
    resize(width, height, dpr) {
        this.width = Math.max(1, width);
        this.height = Math.max(1, height);
        this.dpr = dpr;
        this.applySize();
    }
    applySize() {
        this.gl?.setPixelRatio(this.dpr * this.quality.dprScale);
        this.gl?.setSize(this.width, this.height, false);
    }
    dispose() {
        if (this.contextSurface && this.onContextLost && this.onContextRestored) {
            this.contextSurface.removeEventListener?.('webglcontextlost', this.onContextLost);
            this.contextSurface.removeEventListener?.('webglcontextrestored', this.onContextRestored);
        }
        this.contextSurface = null;
        this.onContextLost = null;
        this.onContextRestored = null;
        for (const t of this.textures.values())
            t.dispose();
        for (const t of this.targets.values())
            t.dispose();
        this.textures.clear();
        this.targets.clear();
        // Release pooled GPU resources held by spawned meshes (defaultMeshFactory
        // creates a fresh Box/Plane/SphereGeometry + material per object).
        for (const obj of this.objects.values()) {
            const mesh = obj;
            mesh.geometry?.dispose?.();
            const material = mesh.material;
            if (Array.isArray(material)) {
                for (const m of material)
                    m.dispose?.();
            }
            else {
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
function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

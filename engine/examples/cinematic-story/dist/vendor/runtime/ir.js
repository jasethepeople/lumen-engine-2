/**
 * @lumen/runtime — SceneIR structural contract.
 *
 * SceneIR is the versioned, JSON-serializable scene document emitted by
 * @lumen/codegen (`SceneIR`, schema version 1) and embedded into generated
 * entry modules. Its types are owned by @lumen/contracts; this module keeps
 * the runtime behavior (validation, raising, manifest synthesis).
 */
import { SCENE_IR_VERSION } from '@lumen/contracts';
// SceneIR types are owned by @lumen/contracts (single declaration of the
// codegen -> runtime handshake). Re-exported here so
// `import { SceneIR } from '@lumen/runtime'` keeps working.
export { SCENE_IR_VERSION } from '@lumen/contracts';
/** Structural check for a SceneIR document (accepts unknown JSON). */
export function isSceneIR(value) {
    return describeSceneIRError(value) === null;
}
/**
 * Deep structural validation for a SceneIR document. Returns null when the
 * document is valid, otherwise a descriptive message naming the first
 * violation found. Checks go beyond the top-level shape: schema version,
 * node ids (recursive), track targets resolving to real nodes, interaction
 * bindings resolving to real tracks, and non-empty asset ids/srcs.
 */
export function describeSceneIRError(value) {
    if (typeof value !== 'object' || value === null)
        return 'SceneIR must be an object';
    const ir = value;
    if (ir.version !== SCENE_IR_VERSION) {
        return `SceneIR version mismatch: expected ${SCENE_IR_VERSION}, got ${JSON.stringify(ir.version)}`;
    }
    if (typeof ir.site !== 'object' || ir.site === null || typeof ir.site.id !== 'string') {
        return 'SceneIR requires site with a string id';
    }
    for (const key of ['nodes', 'tracks', 'bindings', 'assets']) {
        if (!Array.isArray(ir[key]))
            return `SceneIR requires '${key}' to be an array`;
    }
    if (typeof ir.hydration !== 'object' || ir.hydration === null)
        return "SceneIR requires a 'hydration' object";
    // Collect node ids recursively; reject duplicates and malformed nodes.
    const nodeIds = new Set();
    const walk = (nodes, path) => {
        for (const n of nodes) {
            if (typeof n !== 'object' || n === null || typeof n.id !== 'string' || n.id === '') {
                return `node at ${path} requires a non-empty string id`;
            }
            if (nodeIds.has(n.id))
                return `duplicate node id '${n.id}'`;
            nodeIds.add(n.id);
            if (!Array.isArray(n.children))
                return `node '${n.id}' requires a 'children' array`;
            const err = walk(n.children, `${path}/${n.id}`);
            if (err)
                return err;
        }
        return null;
    };
    const nodeErr = walk(ir.nodes, 'nodes');
    if (nodeErr)
        return nodeErr;
    // Tracks: ids unique, targets must resolve to a node in the graph.
    const trackIds = new Set();
    for (const t of ir.tracks) {
        if (typeof t !== 'object' || t === null || typeof t.id !== 'string' || t.id === '') {
            return 'every track requires a non-empty string id';
        }
        if (trackIds.has(t.id))
            return `duplicate track id '${t.id}'`;
        trackIds.add(t.id);
        if (typeof t.target !== 'string' || !nodeIds.has(t.target)) {
            return `track '${t.id}' targets unknown node ${JSON.stringify(t.target)}`;
        }
    }
    // Bindings: every interaction binding must reference an existing track.
    for (const b of ir.bindings) {
        const label = typeof b?.id === 'string' ? b.id : '(no id)';
        if (typeof b?.targetTrackId !== 'string' || !trackIds.has(b.targetTrackId)) {
            return `binding '${label}' references unknown track ${JSON.stringify(b?.targetTrackId)}`;
        }
    }
    // Assets: ids and source urls must be non-empty strings.
    for (const a of ir.assets) {
        if (typeof a?.id !== 'string' || a.id === '')
            return 'every asset requires a non-empty string id';
        if (typeof a.src !== 'string' || a.src === '')
            return `asset '${a.id}' requires a non-empty src url`;
    }
    return null;
}
/** Raise one IRNode subtree into a contract SceneNode. */
function raiseNode(ir) {
    let payload;
    switch (ir.kind) {
        case 'dom':
            payload = { html: ir.html ?? '' };
            // P11: re-materialize the dom richness fields carried across the wire.
            if (ir.anchor !== undefined)
                payload.anchor = ir.anchor;
            if (ir.rect !== undefined)
                payload.rect = ir.rect;
            if (ir.layerGroup !== undefined)
                payload.layerGroup = ir.layerGroup;
            break;
        case 'video-plane':
            payload = { assetId: ir.assetId ?? '', scrubbed: ir.scrubbed ?? true };
            break;
        case 'mesh':
        case 'sprite':
            payload = { assetId: ir.assetId ?? '' };
            break;
        default:
            payload = undefined;
    }
    return {
        id: ir.id,
        kind: ir.kind,
        transform: ir.transform,
        layer: ir.layer,
        visible: ir.visible,
        bindings: ir.bindings ?? [],
        children: (ir.children ?? []).map(raiseNode),
        payload,
        meta: ir.meta,
    };
}
/**
 * Build a contract ComposedScene from SceneIR. This is the runtime half of
 * codegen's lowering: nodes/tracks/bindings pass through, payloads are
 * re-materialized from their flattened IR fields.
 */
export function composedSceneFromIR(ir) {
    return {
        sceneGraph: ir.nodes.map(raiseNode),
        tracks: ir.tracks.map((t) => ({ ...t })),
        bindings: ir.bindings.map((b) => ({ ...b })),
        hydration: ir.hydration,
    };
}
/**
 * Synthesize a minimal AssetManifest from runtime asset references.
 *
 * The full manifest (responsive variants, byte sizes, posters) is produced by
 * the build pipeline; at boot time the runtime only has `IRAssetRef`s, so it
 * materializes one conservative entry per ref. Unknown/zero dimensions are
 * filled once the asset decodes. Also used by the root `createEngine()` so
 * template composition can resolve asset ids before any build has run.
 */
/**
 * Build a manifest entry from a wire variant array (P2). The entry is a
 * faithful pass-through of the variants: image avif/webp widths become
 * srcsets, video mp4/webm/hls variants map by format/codec, and
 * `scrubOptimized` is set only when a `delivery:'gop1'` variant exists
 * (fixing the blind `scrubOptimized:true` of the synthesis path).
 */
function entryFromVariants(ref, variants, base) {
    if (ref.kind === 'image') {
        const srcsetFor = (format) => {
            const set = {};
            for (const v of variants) {
                if (v.format === format && typeof v.width === 'number')
                    set[v.width] = v.src;
            }
            return Object.keys(set).length > 0 ? set : undefined;
        };
        const avif = srcsetFor('avif');
        const webp = srcsetFor('webp');
        const plain = variants.find((v) => v.format === undefined);
        return {
            ...base,
            kind: 'image',
            width: 0,
            height: 0,
            variants: {
                ...(avif ? { avif: { srcset: avif } } : {}),
                ...(webp ? { webp: { srcset: webp } } : {}),
                fallback: { url: plain?.src ?? ref.src, mime: 'image/*' },
            },
            irVariants: [...variants],
        };
    }
    if (ref.kind === 'video') {
        const mp4v = variants.find((v) => v.format === 'mp4');
        const webmv = variants.find((v) => v.format === 'webm');
        const hlsv = variants.find((v) => v.format === 'hls' || v.delivery === 'hls');
        const posterv = variants.find((v) => v.format === 'poster');
        const codec = mp4v?.codec;
        return {
            ...base,
            kind: 'video',
            duration: typeof ref.duration === 'number' && Number.isFinite(ref.duration) && ref.duration > 0
                ? ref.duration
                : 0,
            width: 0,
            height: 0,
            poster: posterv?.src ?? '',
            variants: {
                ...(hlsv ? { hls: { playlist: hlsv.src, bandwidths: [] } } : {}),
                ...(mp4v
                    ? {
                        mp4: {
                            url: mp4v.src,
                            bytes: mp4v.bytes ?? 0,
                            codec: codec === 'hevc' || codec === 'av1' ? codec : 'h264',
                        },
                    }
                    : {}),
                ...(webmv ? { webm: { url: webmv.src, bytes: webmv.bytes ?? 0 } } : {}),
            },
            scrubOptimized: variants.some((v) => v.delivery === 'gop1'),
            irVariants: [...variants],
        };
    }
    return null;
}
export function manifestFromAssetRefs(refs) {
    const assets = {};
    for (const ref of refs) {
        const preload = ref.preload ?? 'lazy';
        const base = { id: ref.id, preload, bytes: 0 };
        if (ref.variants && ref.variants.length > 0) {
            const entry = entryFromVariants(ref, ref.variants, base);
            if (entry) {
                assets[ref.id] = entry;
                continue;
            }
        }
        switch (ref.kind) {
            case 'image':
                assets[ref.id] = {
                    ...base,
                    kind: 'image',
                    width: 0,
                    height: 0,
                    variants: { fallback: { url: ref.src, mime: 'image/*' } },
                };
                break;
            case 'video':
                assets[ref.id] = {
                    ...base,
                    kind: 'video',
                    // Non-finite/<=0 durations mean "unknown" — templates fall back
                    // to the scroll range instead of collapsing scrub to a no-op.
                    duration: typeof ref.duration === 'number' && Number.isFinite(ref.duration) && ref.duration > 0
                        ? ref.duration
                        : 0,
                    width: 0,
                    height: 0,
                    poster: '',
                    variants: { mp4: { url: ref.src, bytes: 0, codec: 'h264' } },
                    scrubOptimized: true,
                };
                break;
            case 'model':
                assets[ref.id] = {
                    ...base,
                    kind: 'model',
                    url: ref.src,
                    textures: 'webp-fallback',
                    draco: false,
                    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
                };
                break;
            case 'font':
                assets[ref.id] = {
                    ...base,
                    kind: 'font',
                    family: ref.id,
                    url: ref.src,
                    weight: 400,
                    style: 'normal',
                };
                break;
            case 'lottie':
                assets[ref.id] = { ...base, kind: 'lottie', url: ref.src, duration: 0, frameRate: 60 };
                break;
            case 'audio':
                assets[ref.id] = { ...base, kind: 'audio', duration: 0, variants: {} };
                break;
        }
    }
    return { version: 1, generatedAt: new Date(0).toISOString(), assets };
}

/**
 * World-state → DrawCall adapter.
 *
 * Rendering owns the payload conventions its renderers decode (DomRenderer:
 * `{kind, html?, assetId?, rect, opacity?, transform?, visible?}`; mesh/sprite
 * payloads carry the raw world transform for the WebGL MeshFactory). The
 * runtime orchestrates scene evaluation and calls into this adapter; changing
 * a renderer's payload decoding only requires editing this package.
 */
/** Read the effective opacity a binding may have written to payload.material. */
function nodeOpacity(node) {
    const material = node.payload?.material;
    const opacity = material?.opacity;
    return typeof opacity === 'number' ? opacity : 1;
}
/** True when a quaternion is (numerically) the identity rotation. */
function quatIsIdentity(q) {
    return q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1;
}
/** Round for stable, compact CSS output. */
function cssNum(n) {
    return Math.abs(n) < 1e-12 ? 0 : Math.round(n * 1e6) / 1e6;
}
/**
 * CSS transform for the non-translation part of a world transform (P11).
 * Identity rotation keeps the legacy `scale(x, y)` string bit-for-bit;
 * any non-identity quaternion emits a full `matrix3d(...)` so rotations
 * reach CSS. Column-major order as required by CSS matrix3d.
 */
function cssTransform(t) {
    const [sx, sy, sz] = t.scale;
    const q = t.rotationQuat;
    if (quatIsIdentity(q)) {
        if (sx === 1 && sy === 1)
            return undefined;
        return `scale(${sx}, ${sy})`;
    }
    const [x, y, z, w] = q;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    // Rotation matrix scaled per-column (M = R * S), column-major for CSS.
    const m = [
        (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
        (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
        0, 0, 0, 1,
    ];
    return `matrix3d(${m.map(cssNum).join(', ')})`;
}
/**
 * Adapt one scene node + its world transform into a DrawCall following the
 * renderer payload conventions above. Returns null for node kinds that
 * produce no draw call (groups/cameras/lights).
 */
export function drawCallForNode(node, world, surface) {
    // P11 rect policy: an explicit payload rect wins; fall back to the
    // surface-minus-position derivation only when absent.
    const domPayload = node.payload;
    const rect = domPayload?.rect ?? {
        x: world.position[0],
        y: world.position[1],
        width: Math.max(0, surface.width - world.position[0]),
        height: Math.max(0, surface.height - world.position[1]),
    };
    switch (node.kind) {
        case 'dom':
            return {
                nodeId: node.id,
                layer: node.layer,
                payload: {
                    kind: 'dom',
                    html: domPayload?.html ?? '',
                    rect,
                    opacity: nodeOpacity(node),
                    transform: cssTransform(world),
                    visible: node.visible,
                    layerGroup: domPayload?.layerGroup,
                },
            };
        case 'video-plane':
            return {
                nodeId: node.id,
                layer: node.layer,
                payload: {
                    kind: 'video',
                    assetId: node.payload?.assetId ?? '',
                    rect,
                    opacity: nodeOpacity(node),
                    transform: cssTransform(world),
                    visible: node.visible,
                },
            };
        case 'mesh':
        case 'sprite':
            return {
                nodeId: node.id,
                layer: node.layer,
                payload: {
                    kind: node.kind,
                    assetId: node.payload?.assetId ?? '',
                    transform: world,
                    material: node.payload?.material,
                },
            };
        default:
            return null; // groups/cameras/lights produce no draw call
    }
}
/** Adapt a whole WorldState snapshot into a layer-sorted draw list. */
export function drawCallsFromWorldState(world, surface) {
    const drawList = [];
    for (const entry of world.entries) {
        if (!entry.visible)
            continue;
        const call = drawCallForNode(entry.node, entry.worldTransform, surface);
        if (call)
            drawList.push(call);
    }
    drawList.sort((a, b) => a.layer - b.layer);
    return drawList;
}

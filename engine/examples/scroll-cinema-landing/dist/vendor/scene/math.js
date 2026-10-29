/**
 * @lumen/scene — math primitives.
 * Minimal Vec2/Vec3/Quat + Transform ops needed by the scene graph and
 * timeline interpolator. Pure functions, no allocations beyond return values,
 * no DOM — safe for Node and workers.
 */
// ---------------------------------------------------------------------------
// Vec2 / Vec3
// ---------------------------------------------------------------------------
export const vec2 = (x = 0, y = 0) => [x, y];
export const vec3 = (x = 0, y = 0, z = 0) => [x, y, z];
export function add3(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function mul3(a, b) {
    return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}
export function scale3(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
}
/** Linear interpolation between scalars. */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}
/** Component-wise lerp between same-length numeric tuples. */
export function lerpArray(a, b, t) {
    const out = new Array(a.length);
    for (let i = 0; i < a.length; i++)
        out[i] = lerp(a[i], b[i] ?? a[i], t);
    return out;
}
export function lerpVec3(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
// ---------------------------------------------------------------------------
// Quat
// ---------------------------------------------------------------------------
export const QUAT_IDENTITY = [0, 0, 0, 1];
export function quatIdentity() {
    return [0, 0, 0, 1];
}
/** Hamilton product a ⊗ b (apply b first, then a). */
export function quatMul(a, b) {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
}
export function quatNormalize(q) {
    const len = Math.hypot(q[0], q[1], q[2], q[3]);
    if (len === 0)
        return quatIdentity();
    return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}
/** Rotate a Vec3 by a quaternion (assumes q is normalized). */
export function quatRotateVec3(q, v) {
    const [qx, qy, qz, qw] = q;
    const [vx, vy, vz] = v;
    // t = 2 * q.xyz × v
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    // v' = v + qw * t + q.xyz × t
    return [
        vx + qw * tx + (qy * tz - qz * ty),
        vy + qw * ty + (qz * tx - qx * tz),
        vz + qw * tz + (qx * ty - qy * tx),
    ];
}
/**
 * Normalized lerp between quaternions with shortest-path correction.
 * Adequate for keyframe interpolation (cheaper than full slerp).
 */
export function quatNlerp(a, b, t) {
    let [bx, by, bz, bw] = b;
    const dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
    if (dot < 0) {
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
    }
    return quatNormalize([
        lerp(a[0], bx, t),
        lerp(a[1], by, t),
        lerp(a[2], bz, t),
        lerp(a[3], bw, t),
    ]);
}
// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------
export function identityTransform() {
    return { position: vec3(), rotationQuat: quatIdentity(), scale: vec3(1, 1, 1) };
}
export function cloneTransform(t) {
    return {
        position: [t.position[0], t.position[1], t.position[2]],
        rotationQuat: [t.rotationQuat[0], t.rotationQuat[1], t.rotationQuat[2], t.rotationQuat[3]],
        scale: [t.scale[0], t.scale[1], t.scale[2]],
    };
}
/**
 * Compose parent ∘ child (world = parent applied to child).
 * Assumes TRS chains without shear: scales compose component-wise.
 */
export function composeTransform(parent, child) {
    const scaled = mul3(child.position, parent.scale);
    return {
        position: add3(quatRotateVec3(parent.rotationQuat, scaled), parent.position),
        rotationQuat: quatNormalize(quatMul(parent.rotationQuat, child.rotationQuat)),
        scale: mul3(parent.scale, child.scale),
    };
}
/** Interpolate two transforms (position/scale lerp, rotation nlerp). */
export function lerpTransform(a, b, t) {
    return {
        position: lerpVec3(a.position, b.position, t),
        rotationQuat: quatNlerp(a.rotationQuat, b.rotationQuat, t),
        scale: lerpVec3(a.scale, b.scale, t),
    };
}
export function transformsEqual(a, b, eps = 1e-9) {
    for (let i = 0; i < 3; i++) {
        if (Math.abs(a.position[i] - b.position[i]) > eps)
            return false;
        if (Math.abs(a.scale[i] - b.scale[i]) > eps)
            return false;
    }
    for (let i = 0; i < 4; i++) {
        if (Math.abs(a.rotationQuat[i] - b.rotationQuat[i]) > eps)
            return false;
    }
    return true;
}

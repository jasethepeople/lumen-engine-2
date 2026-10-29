/**
 * @lumen/runtime — scroll-scrub wiring.
 *
 * Scroll templates bind a scroll-driven track to a video-plane node's
 * `playback.time` pseudo-property. That path is not a real SceneNode
 * property (the scene layer cannot apply it), so the runtime handles it as
 * a first-class binding: each frame, the resolved playhead value is routed
 * to the loaded video asset's `seekTo()` — throttled so a fast scroller
 * does not flood the decoder.
 */
/** Binding path treated as "video playback position in seconds". */
export const SCRUB_PROPERTY = 'playback.time';
/**
 * Walk the scene graph and collect video-plane nodes that carry a
 * `playback.time` binding and are marked scrubbed.
 */
export function collectScrubTargets(scene) {
    const targets = [];
    const visit = (node) => {
        if (node.kind === 'video-plane' && node.payload) {
            const payload = node.payload;
            if (payload.scrubbed === false) {
                // free playback — not scrub-wired
            }
            else if (typeof payload.assetId === 'string' && payload.assetId !== '') {
                const binding = node.bindings.find((b) => b.property === SCRUB_PROPERTY);
                if (binding)
                    targets.push({ nodeId: node.id, assetId: payload.assetId, trackId: binding.trackId });
            }
        }
        for (const child of node.children)
            visit(child);
    };
    for (const root of scene.graph.roots)
        visit(root);
    return targets;
}
/**
 * Create the frame-loop scrubber. Seeks are fire-and-forget: seek failures
 * (stalled element, missing asset) are reported once per target burst via
 * onError and never reject the frame loop.
 */
export function createScrubber(options) {
    const minIntervalMs = options.minIntervalMs ?? 120;
    const epsilon = options.epsilon ?? 1 / 30;
    const now = options.now ?? (() => performance.now());
    const last = new Map();
    return {
        update(playheads, targets) {
            const t = now();
            for (const target of targets) {
                const raw = playheads.get(target.trackId);
                if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0)
                    continue;
                const prev = last.get(target.trackId);
                if (prev && Math.abs(raw - prev.value) < epsilon)
                    continue;
                if (prev && t - prev.at < minIntervalMs)
                    continue;
                last.set(target.trackId, { value: raw, at: t });
                const handle = options.assets.get(target.assetId);
                if (!handle || handle.kind !== 'video')
                    continue; // not loaded (yet)
                handle.video.seekTo(raw).catch((cause) => {
                    options.onError({
                        module: 'runtime',
                        code: 'SCRUB_SEEK_FAILED',
                        recoverable: true,
                        cause,
                    });
                });
            }
        },
        dispose() {
            last.clear();
        },
    };
}

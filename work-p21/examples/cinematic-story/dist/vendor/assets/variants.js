const DEFAULT_VIEWPORT_WIDTH = 1280;
export function pickVariant(profile, variants, kind, options = {}) {
    if (profile === undefined || variants.length === 0)
        return undefined;
    const viewport = options.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH;
    // 1. Codec support (video only — the profile carries a video codec matrix).
    let pool = variants.filter((v) => {
        if (kind === 'video' && typeof v.codec === 'string') {
            const support = profile.codecs[v.codec];
            if (support && !support.supported)
                return false;
        }
        return true;
    });
    if (pool.length === 0)
        pool = [...variants]; // never starve: legacy order wins
    // 2. Memory-constrained devices avoid oversized payloads.
    const fitLimit = profile.dpr.current * viewport;
    if (profile.deviceMemoryGB !== null && profile.deviceMemoryGB <= 4) {
        const small = pool.filter((v) => v.width === undefined || v.width <= fitLimit);
        if (small.length > 0)
            pool = small;
    }
    // 3. Widest variant within 2× the dpr-scaled viewport.
    const within2x = pool.filter((v) => v.width === undefined || v.width <= 2 * fitLimit);
    if (within2x.length > 0)
        pool = within2x;
    const sized = pool.filter((v) => v.width !== undefined);
    if (sized.length > 0) {
        let best = sized[0];
        for (const v of sized)
            if (v.width > best.width)
                best = v;
        return best;
    }
    return pool[0];
}

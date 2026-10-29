/**
 * Two-tier asset cache.
 *
 * Tier 1: in-memory LRU keyed by content hash (hot decoded payloads).
 * Tier 2: persistent store — the Cache API when available (service-worker
 * scope or window.caches), falling back to a minimal IndexedDB blob store.
 * Both tiers degrade gracefully: under Node (no caches/IndexedDB) the
 * persistent tier becomes a no-op and the memory tier still functions.
 *
 * Keys are content-hash keys derived from the manifest (see
 * `contentHashKey` in manifest.ts), so a manifest bump invalidates stale
 * entries naturally.
 */
/** In-memory LRU cache with O(1) get/set via Map insertion ordering. */
export class LruCache {
    maxEntries;
    maxBytes;
    sizeOf;
    map = new Map();
    totalBytes = 0;
    constructor(
    /** Max number of entries retained. */
    maxEntries = 64, 
    /** Optional byte budget; entries may carry a `byteLength`/`bytes` size. */
    maxBytes = Infinity, sizeOf = () => 1) {
        this.maxEntries = maxEntries;
        this.maxBytes = maxBytes;
        this.sizeOf = sizeOf;
    }
    get size() {
        return this.map.size;
    }
    get bytes() {
        return this.totalBytes;
    }
    has(key) {
        return this.map.has(key);
    }
    get(key) {
        const value = this.map.get(key);
        if (value === undefined)
            return undefined;
        // Refresh recency: delete + re-insert moves the key to the tail.
        this.map.delete(key);
        this.map.set(key, value);
        return value;
    }
    set(key, value) {
        const size = this.sizeOf(value);
        if (this.map.has(key)) {
            const old = this.map.get(key);
            this.totalBytes -= this.sizeOf(old);
            this.map.delete(key);
        }
        this.map.set(key, value);
        this.totalBytes += size;
        this.evictIfNeeded();
    }
    delete(key) {
        const value = this.map.get(key);
        if (value === undefined)
            return false;
        this.totalBytes -= this.sizeOf(value);
        return this.map.delete(key);
    }
    clear() {
        this.map.clear();
        this.totalBytes = 0;
    }
    /** Least-recently-used key, or undefined when empty. */
    lruKey() {
        return this.map.keys().next().value;
    }
    keys() {
        return [...this.map.keys()];
    }
    evictIfNeeded() {
        while (this.map.size > this.maxEntries || this.totalBytes > this.maxBytes) {
            const victim = this.map.keys().next();
            if (victim.done)
                break;
            const value = this.map.get(victim.value);
            this.totalBytes -= this.sizeOf(value);
            this.map.delete(victim.value);
        }
    }
}
/* ------------------------------------------------- persistent tier (T2) */
const DB_NAME = 'lumen-assets';
const STORE = 'assets';
function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE)) {
                req.result.createObjectStore(STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    });
}
async function idbGet(key) {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error ?? new Error('indexedDB get failed'));
        });
    }
    finally {
        db.close();
    }
}
async function idbSet(key, value) {
    const db = await openDb();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('indexedDB put failed'));
        });
    }
    finally {
        db.close();
    }
}
async function idbClear() {
    const db = await openDb();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('indexedDB clear failed'));
        });
    }
    finally {
        db.close();
    }
}
/**
 * Persistent cache tier. Prefers the Cache API (per-Response semantics,
 * opaque-cors friendly); falls back to IndexedDB; no-op outside browsers.
 */
export class PersistentCache {
    cacheName;
    cachePromise = null;
    constructor(cacheName = 'lumen-assets-v1') {
        this.cacheName = cacheName;
    }
    /** True when any persistent backend is available. */
    get supported() {
        return ((typeof caches !== 'undefined' && caches !== null) ||
            typeof indexedDB !== 'undefined');
    }
    async cacheApi() {
        if (typeof caches === 'undefined')
            return null;
        this.cachePromise ??= caches.open(this.cacheName);
        try {
            return await this.cachePromise;
        }
        catch (cause) {
            // A rejected open (private mode, quota) must not poison the tier
            // forever — drop it so the next call retries or falls back to IDB.
            this.cachePromise = null;
            throw cause;
        }
    }
    static toRequestUrl(key) {
        // Cache API needs a URL; hash keys are turned into same-origin pseudo-URLs.
        return `https://assets.lumen.internal/${encodeURIComponent(key)}`;
    }
    async get(key) {
        try {
            const cache = await this.cacheApi();
            if (cache) {
                const res = await cache.match(PersistentCache.toRequestUrl(key));
                const buf = res ? await res.arrayBuffer() : undefined;
                // Zero-byte/corrupt payloads are misses, not hits.
                return buf && buf.byteLength > 0 ? buf : undefined;
            }
            if (typeof indexedDB !== 'undefined') {
                const buf = await idbGet(key);
                return buf && buf.byteLength > 0 ? buf : undefined;
            }
            return undefined;
        }
        catch {
            return undefined; // persistence is best-effort
        }
    }
    async set(key, value) {
        try {
            const cache = await this.cacheApi();
            if (cache) {
                await cache.put(PersistentCache.toRequestUrl(key), new Response(value));
                return;
            }
            if (typeof indexedDB !== 'undefined')
                await idbSet(key, value);
        }
        catch {
            /* best-effort */
        }
    }
    async clear() {
        try {
            if (typeof caches !== 'undefined') {
                await caches.delete(this.cacheName);
                this.cachePromise = null;
                return;
            }
            if (typeof indexedDB !== 'undefined')
                await idbClear();
        }
        catch {
            /* best-effort */
        }
    }
}
/**
 * Two-tier cache facade: memory LRU in front of the persistent tier.
 * Stores raw payload bytes (ArrayBuffer); decoded objects belong to the
 * AssetManager's handle map, not to the persistent tier.
 */
export class AssetCache {
    memory;
    persistent;
    constructor(opts = {}) {
        this.memory = new LruCache(opts.maxEntries ?? 64, opts.maxBytes ?? 256 * 1024 * 1024, (buf) => buf.byteLength);
        this.persistent = new PersistentCache(opts.cacheName);
    }
    async get(key) {
        const hit = this.memory.get(key);
        if (hit)
            return hit;
        const stored = await this.persistent.get(key);
        if (stored)
            this.memory.set(key, stored);
        return stored;
    }
    async set(key, value) {
        this.memory.set(key, value);
        await this.persistent.set(key, value);
    }
    async clear() {
        this.memory.clear();
        await this.persistent.clear();
    }
}

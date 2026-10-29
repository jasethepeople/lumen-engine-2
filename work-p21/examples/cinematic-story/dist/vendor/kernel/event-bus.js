/**
 * Strongly typed pub/sub event bus over the frozen `EngineEventMap`.
 *
 * All cross-module communication flows through this bus. Listener errors are
 * isolated: a throwing listener never breaks `emit` for other listeners.
 */
export function createEventBus(options = {}) {
    const { onListenerError } = options;
    const subscriptions = new Map();
    const wildcardHandlers = new Set();
    function reportListenerError(error, event) {
        if (onListenerError) {
            try {
                onListenerError(error, event);
            }
            catch {
                // The error hook itself must never break emit.
            }
        }
    }
    function on(event, handler) {
        let set = subscriptions.get(event);
        if (!set) {
            set = new Set();
            subscriptions.set(event, set);
        }
        const sub = { handler: handler, once: false };
        set.add(sub);
        return () => {
            set.delete(sub);
            if (set.size === 0)
                subscriptions.delete(event);
        };
    }
    function once(event, handler) {
        const unsubscribe = on(event, handler);
        // Wrap: mark the most recent subscription for this handler as once.
        // Implemented via a dedicated subscription for clarity.
        unsubscribe();
        let set = subscriptions.get(event);
        if (!set) {
            set = new Set();
            subscriptions.set(event, set);
        }
        const sub = { handler: handler, once: true };
        set.add(sub);
        return () => {
            set.delete(sub);
            if (set.size === 0)
                subscriptions.delete(event);
        };
    }
    function off(event, handler) {
        const set = subscriptions.get(event);
        if (!set)
            return;
        for (const sub of set) {
            if (sub.handler === handler)
                set.delete(sub);
        }
        if (set.size === 0)
            subscriptions.delete(event);
    }
    function onAny(handler) {
        wildcardHandlers.add(handler);
        return () => {
            wildcardHandlers.delete(handler);
        };
    }
    function emit(event, payload) {
        const set = subscriptions.get(event);
        if (set) {
            // Snapshot: listeners may unsubscribe during emit.
            for (const sub of [...set]) {
                try {
                    sub.handler(payload);
                }
                catch (error) {
                    reportListenerError(error, event);
                }
                finally {
                    if (sub.once)
                        set.delete(sub);
                }
            }
            if (set.size === 0)
                subscriptions.delete(event);
        }
        if (wildcardHandlers.size > 0) {
            for (const handler of [...wildcardHandlers]) {
                try {
                    handler(event, payload);
                }
                catch (error) {
                    reportListenerError(error, event);
                }
            }
        }
    }
    function listenerCount(event) {
        if (event !== undefined)
            return subscriptions.get(event)?.size ?? 0;
        let total = wildcardHandlers.size;
        for (const set of subscriptions.values())
            total += set.size;
        return total;
    }
    function clear() {
        subscriptions.clear();
        wildcardHandlers.clear();
    }
    return { on, once, off, onAny, emit, listenerCount, clear };
}

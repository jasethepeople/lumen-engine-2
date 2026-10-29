/**
 * Plugin registry: registers `LumenPlugin`s, resolves the dependency DAG
 * implied by `provides`/`consumes` capability tokens, initializes plugins in
 * topological order with a narrowed `KernelContext`, and disposes them in
 * reverse order. Plugin failures are contained via error boundaries and
 * reported through `engine:error`.
 */
import { KERNEL_ERROR_CODES, createEngineError, guardAsync } from './errors.js';
/** Topologically order plugins so providers init before consumers. */
export function resolvePluginOrder(plugins) {
    const providers = new Map(); // token -> plugin name
    for (const plugin of plugins) {
        for (const token of plugin.provides ?? []) {
            if (!providers.has(token))
                providers.set(token, plugin.name);
        }
    }
    const edges = new Map(); // consumer -> providers it depends on
    for (const plugin of plugins) {
        const deps = new Set();
        for (const token of plugin.consumes ?? []) {
            const provider = providers.get(token);
            if (provider == null) {
                throw createEngineError({
                    module: 'kernel',
                    code: KERNEL_ERROR_CODES.PLUGIN_MISSING_DEPENDENCY,
                    recoverable: false,
                    cause: `Plugin "${plugin.name}" consumes "${token}" but no plugin provides it`,
                });
            }
            if (provider !== plugin.name)
                deps.add(provider);
        }
        edges.set(plugin.name, deps);
    }
    const ordered = [];
    const byName = new Map(plugins.map((p) => [p.name, p]));
    const done = new Set();
    const visiting = new Set();
    const visit = (name) => {
        if (done.has(name))
            return;
        if (visiting.has(name)) {
            throw createEngineError({
                module: 'kernel',
                code: KERNEL_ERROR_CODES.PLUGIN_CYCLE,
                recoverable: false,
                cause: `Plugin dependency cycle involving "${name}"`,
            });
        }
        visiting.add(name);
        for (const dep of edges.get(name) ?? [])
            visit(dep);
        visiting.delete(name);
        done.add(name);
        const plugin = byName.get(name);
        if (plugin)
            ordered.push(plugin);
    };
    for (const plugin of plugins)
        visit(plugin.name);
    return ordered;
}
/**
 * P14: true when any *other* registered plugin consumes a token `plugin`
 * provides — an init failure then remains an unmet mandatory dependency.
 */
function isProvidedTokenConsumed(plugin, all) {
    const provided = new Set(plugin.provides ?? []);
    if (provided.size === 0)
        return false;
    return all.some((other) => other.name !== plugin.name && (other.consumes ?? []).some((token) => provided.has(token)));
}
export function createPluginRegistry(options) {
    const plugins = [];
    const names = new Set();
    let ordered = [];
    let orderedDirty = false;
    const initialized = [];
    return {
        register(plugin) {
            if (names.has(plugin.name)) {
                throw createEngineError({
                    module: 'kernel',
                    code: KERNEL_ERROR_CODES.DUPLICATE_PLUGIN,
                    recoverable: false,
                    cause: `Duplicate plugin name "${plugin.name}"`,
                });
            }
            names.add(plugin.name);
            plugins.push(plugin);
            orderedDirty = true;
        },
        get order() {
            // Order is computed lazily: providers may register after consumers.
            if (orderedDirty) {
                ordered = resolvePluginOrder(plugins);
                orderedDirty = false;
            }
            return ordered;
        },
        has(name) {
            return names.has(name);
        },
        async initAll(ctx) {
            for (const plugin of this.order) {
                // Track only successful inits so disposeAll only touches live plugins.
                // Init failures are reported via engine:error AND abort boot:
                // guardAsync only reports, so capture the failure and rethrow to
                // reject kernel.start() — an engine with a failed non-recoverable
                // plugin must never reach 'active' silently.
                let failure = null;
                const ok = await guardAsync({
                    module: plugin.name,
                    code: KERNEL_ERROR_CODES.PLUGIN_INIT_FAILED,
                    // P14: optional plugins report recoverable failures.
                    recoverable: plugin.optional === true,
                    onError: (err) => {
                        failure = err;
                        options.onError(err);
                    },
                }, async () => {
                    await plugin.init(ctx);
                    return true;
                });
                if (ok === true) {
                    initialized.push(plugin);
                }
                else if (failure !== null) {
                    // P14: optional plugins degrade gracefully when nothing depends on
                    // the tokens they provide; otherwise the failure stays fatal.
                    if (plugin.optional === true && !isProvidedTokenConsumed(plugin, plugins)) {
                        continue; // boot without it; disposeAll never sees it
                    }
                    throw failure;
                }
            }
        },
        async disposeAll() {
            for (const plugin of [...initialized].reverse()) {
                await guardAsync({
                    module: plugin.name,
                    code: KERNEL_ERROR_CODES.PLUGIN_DISPOSE_FAILED,
                    recoverable: true,
                    onError: options.onError,
                }, () => plugin.dispose());
            }
            initialized.length = 0;
        },
    };
}

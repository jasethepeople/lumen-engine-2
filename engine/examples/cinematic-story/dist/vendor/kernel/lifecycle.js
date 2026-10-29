/**
 * Lifecycle state machine over the frozen `LifecyclePhase` union:
 * created → booting → loading → ready → active ⇄ paused → disposed.
 *
 * Illegal transitions throw a structured EngineError. Valid transitions emit
 * `lifecycle:change`, `lifecycle:leave`, and `lifecycle:enter` on the bus.
 */
import { createEngineError } from './errors.js';
/** Legal transitions. `disposed` is terminal. */
const TRANSITIONS = {
    created: ['booting', 'disposed'],
    booting: ['loading', 'disposed'],
    loading: ['ready', 'disposed'],
    ready: ['active', 'disposed'],
    active: ['paused', 'disposed'],
    paused: ['active', 'disposed'],
    disposed: [],
};
export function createLifecycle(bus) {
    let phase = 'created';
    function canTransition(to) {
        return TRANSITIONS[phase].includes(to);
    }
    function transition(to) {
        if (!canTransition(to)) {
            throw createEngineError({
                module: 'kernel',
                code: 'INVALID_LIFECYCLE_TRANSITION',
                recoverable: true,
                cause: `Illegal lifecycle transition: ${phase} → ${to}`,
            });
        }
        const from = phase;
        phase = to;
        const payload = (p) => ({ phase: p });
        bus.emit('lifecycle:change', { from, to });
        bus.emit('lifecycle:leave', payload(from));
        bus.emit('lifecycle:enter', payload(to));
    }
    return {
        get phase() {
            return phase;
        },
        transition,
        canTransition,
    };
}

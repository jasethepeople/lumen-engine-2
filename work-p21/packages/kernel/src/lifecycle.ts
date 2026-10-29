/**
 * Lifecycle state machine over the frozen `LifecyclePhase` union:
 * created → booting → loading → ready → active ⇄ paused → disposed.
 *
 * Illegal transitions throw a structured EngineError. Valid transitions emit
 * `lifecycle:change`, `lifecycle:leave`, and `lifecycle:enter` on the bus.
 */

import type { EngineEventMap, LifecyclePhase } from '@lumen/contracts';
import type { EventBus } from './event-bus.js';
import { createEngineError } from './errors.js';

/** Legal transitions. `disposed` is terminal. */
const TRANSITIONS: Readonly<Record<LifecyclePhase, readonly LifecyclePhase[]>> = {
  created: ['booting', 'disposed'],
  booting: ['loading', 'disposed'],
  loading: ['ready', 'disposed'],
  ready: ['active', 'disposed'],
  active: ['paused', 'disposed'],
  paused: ['active', 'disposed'],
  disposed: [],
};

export interface Lifecycle {
  readonly phase: LifecyclePhase;
  /** Throws an EngineError when the transition is illegal. */
  transition(to: LifecyclePhase): void;
  canTransition(to: LifecyclePhase): boolean;
}

export function createLifecycle(bus: EventBus): Lifecycle {
  let phase: LifecyclePhase = 'created';

  function canTransition(to: LifecyclePhase): boolean {
    return TRANSITIONS[phase].includes(to);
  }

  function transition(to: LifecyclePhase): void {
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
    const payload = (p: LifecyclePhase): EngineEventMap['lifecycle:enter'] => ({ phase: p });
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

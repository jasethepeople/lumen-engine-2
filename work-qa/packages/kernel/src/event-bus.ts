/**
 * Strongly typed pub/sub event bus over the frozen `EngineEventMap`.
 *
 * All cross-module communication flows through this bus. Listener errors are
 * isolated: a throwing listener never breaks `emit` for other listeners.
 */

import type { EngineEventMap } from '@lumen/contracts';

export type EventName = keyof EngineEventMap;

export type EventHandler<K extends EventName> = (payload: EngineEventMap[K]) => void;

/** Wildcard listener: receives every event with its name and payload. */
export type WildcardHandler = <K extends EventName>(event: K, payload: EngineEventMap[K]) => void;

/** Hook invoked when a listener throws. Defaults to swallowing (isolation). */
export type ListenerErrorHandler = (error: unknown, event: EventName) => void;

interface Subscription {
  readonly handler: (payload: never) => void;
  readonly once: boolean;
}

export interface EventBus {
  on<K extends EventName>(event: K, handler: EventHandler<K>): () => void;
  once<K extends EventName>(event: K, handler: EventHandler<K>): () => void;
  off<K extends EventName>(event: K, handler: EventHandler<K>): void;
  onAny(handler: WildcardHandler): () => void;
  emit<K extends EventName>(event: K, payload: EngineEventMap[K]): void;
  listenerCount(event?: EventName): number;
  clear(): void;
}

export interface EventBusOptions {
  /** Called when a listener throws; errors are never rethrown into `emit`. */
  onListenerError?: ListenerErrorHandler;
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
  const { onListenerError } = options;
  const subscriptions = new Map<EventName, Set<Subscription>>();
  const wildcardHandlers = new Set<WildcardHandler>();

  function reportListenerError(error: unknown, event: EventName): void {
    if (onListenerError) {
      try {
        onListenerError(error, event);
      } catch {
        // The error hook itself must never break emit.
      }
    }
  }

  function on<K extends EventName>(event: K, handler: EventHandler<K>): () => void {
    let set = subscriptions.get(event);
    if (!set) {
      set = new Set();
      subscriptions.set(event, set);
    }
    const sub: Subscription = { handler: handler as (payload: never) => void, once: false };
    set.add(sub);
    return () => {
      set.delete(sub);
      if (set.size === 0) subscriptions.delete(event);
    };
  }

  function once<K extends EventName>(event: K, handler: EventHandler<K>): () => void {
    const unsubscribe = on(event, handler);
    // Wrap: mark the most recent subscription for this handler as once.
    // Implemented via a dedicated subscription for clarity.
    unsubscribe();
    let set = subscriptions.get(event);
    if (!set) {
      set = new Set();
      subscriptions.set(event, set);
    }
    const sub: Subscription = { handler: handler as (payload: never) => void, once: true };
    set.add(sub);
    return () => {
      set.delete(sub);
      if (set.size === 0) subscriptions.delete(event);
    };
  }

  function off<K extends EventName>(event: K, handler: EventHandler<K>): void {
    const set = subscriptions.get(event);
    if (!set) return;
    for (const sub of set) {
      if (sub.handler === (handler as (payload: never) => void)) set.delete(sub);
    }
    if (set.size === 0) subscriptions.delete(event);
  }

  function onAny(handler: WildcardHandler): () => void {
    wildcardHandlers.add(handler);
    return () => {
      wildcardHandlers.delete(handler);
    };
  }

  function emit<K extends EventName>(event: K, payload: EngineEventMap[K]): void {
    const set = subscriptions.get(event);
    if (set) {
      // Snapshot: listeners may unsubscribe during emit.
      for (const sub of [...set]) {
        try {
          sub.handler(payload as never);
        } catch (error) {
          reportListenerError(error, event);
        } finally {
          if (sub.once) set.delete(sub);
        }
      }
      if (set.size === 0) subscriptions.delete(event);
    }
    if (wildcardHandlers.size > 0) {
      for (const handler of [...wildcardHandlers]) {
        try {
          handler(event, payload);
        } catch (error) {
          reportListenerError(error, event);
        }
      }
    }
  }

  function listenerCount(event?: EventName): number {
    if (event !== undefined) return subscriptions.get(event)?.size ?? 0;
    let total = wildcardHandlers.size;
    for (const set of subscriptions.values()) total += set.size;
    return total;
  }

  function clear(): void {
    subscriptions.clear();
    wildcardHandlers.clear();
  }

  return { on, once, off, onAny, emit, listenerCount, clear };
}

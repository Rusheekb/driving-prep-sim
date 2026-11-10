import type { EventBus } from './types';

/** Minimal synchronous typed event emitter. */
export function createEventBus<E>(): EventBus<E> {
  const handlers = new Map<keyof E, Set<(payload: never) => void>>();
  return {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler as (payload: never) => void);
      return () => {
        set.delete(handler as (payload: never) => void);
      };
    },
    emit(type, payload) {
      const set = handlers.get(type);
      if (!set) return;
      for (const handler of [...set]) (handler as (p: typeof payload) => void)(payload);
    },
    clear() {
      handlers.clear();
    },
  };
}

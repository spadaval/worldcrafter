/** A value the UI can subscribe to. Shaped for `useSyncExternalStore`. */
export interface Store<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

export interface WritableStore<T> extends Store<T> {
  set(value: T): void;
}

export function createStore<T>(initial: T): WritableStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

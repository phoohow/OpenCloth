/** Resource with an explicit teardown. */
export interface Disposable { dispose(): void }

/** Disposes every resource, ignoring an already-disposed one. */
export function disposeAll(...items: Disposable[]): void {
  for (const item of items) item.dispose();
}

/** One-way notification channel with unsubscribe handles. */
export interface Signal<T> {
  subscribe(listener: (value: T) => void): Disposable;
  emit(value: T): void;
  clear(): void;
}

/** Creates a synchronous signal owned by the caller. */
export function createSignal<T>(): Signal<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    emit(value) {
      for (const listener of [...listeners]) listener(value);
    },
    clear() {
      listeners.clear();
    },
  };
}

/** Controls whether a timed section measures and where it reports. */
export interface TimingOptions {
  enabled?: boolean;
  log?: (message: string) => void;
}

/** Awaits an async section and reports its wall-clock cost when enabled. */
export async function timeAsync<T>(tag: string, fn: () => Promise<T>, options: TimingOptions = {}): Promise<T> {
  if (!options.enabled) return fn();
  const started = performance.now();
  const result = await fn();
  options.log?.(`[time] ${tag}: ${(performance.now() - started).toFixed(1)} ms`);
  return result;
}

/** Debounced function with an explicit cancellation handle. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): ((...args: A) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }) as ((...args: A) => void) & { cancel(): void };
  wrapped.cancel = () => { if (timer !== undefined) clearTimeout(timer); };
  return wrapped;
}

/** Leading-edge throttle that ignores calls inside the quiet period. */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
): (...args: A) => void {
  let last = -Infinity;
  return (...args: A) => {
    const now = Date.now();
    if (now - last < intervalMs) return;
    last = now;
    fn(...args);
  };
}

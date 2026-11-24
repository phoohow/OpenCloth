export interface TimingOptions {
  enabled?: boolean;
  log?: (message: string) => void;
}

export async function timeAsync<T>(tag: string, fn: () => Promise<T>, options: TimingOptions = {}): Promise<T> {
  if (!options.enabled) return fn();
  const started = performance.now();
  const result = await fn();
  options.log?.(`[time] ${tag}: ${(performance.now() - started).toFixed(1)} ms`);
  return result;
}

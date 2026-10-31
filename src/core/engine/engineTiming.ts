/** True while serving unbuilt sources; timing logs stay behind this gate. */
const DEV = import.meta.env.DEV;

/**
 * Awaits an async section and logs its wall-clock cost in dev builds.
 * Production builds drop the wrapper entirely because `import.meta.env.DEV` is false.
 */
export async function timeAsync<T>(tag: string, fn: () => Promise<T>): Promise<T> {
  if (!DEV) return fn();
  const started = performance.now();
  const result = await fn();
  console.log(`[time] ${tag}: ${(performance.now() - started).toFixed(1)} ms`);
  return result;
}

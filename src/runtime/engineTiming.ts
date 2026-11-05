import { timeAsync as measure } from '@/common/time';

/** True while serving unbuilt sources; timing logs stay behind this gate. */
const DEV = import.meta.env.DEV;

/** Awaits an async section and logs its wall-clock cost in dev builds. */
export async function timeAsync<T>(tag: string, fn: () => Promise<T>): Promise<T> {
  return measure(tag, fn, { enabled: DEV, log: message => console.log(message) });
}

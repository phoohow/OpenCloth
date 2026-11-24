import { timeAsync as measure } from '@/base/perf';

const DEV = import.meta.env.DEV;

export async function timeAsync<T>(tag: string, fn: () => Promise<T>): Promise<T> {
  return measure(tag, fn, { enabled: DEV, log: message => console.log(message) });
}

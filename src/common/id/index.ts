/** Creates an id generator with an injected clock; each factory owns its counter. */
export function createIdFactory(now: () => number = () => Date.now()): (prefix?: string) => string {
  let counter = 0;
  return (prefix = 'id') => `${prefix}_${(++counter).toString(36)}_${now().toString(36)}`;
}

const defaultFactory = createIdFactory();

/** Unique record id: prefix, counter and timestamp. */
export function genId(prefix = 'id'): string {
  return defaultFactory(prefix);
}

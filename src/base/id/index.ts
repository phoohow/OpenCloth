const defaultFactory = createIdFactory();

export function createIdFactory(now: () => number = () => Date.now()): (prefix?: string) => string {
  let counter = 0;
  return (prefix = 'id') => `${prefix}_${(++counter).toString(36)}_${now().toString(36)}`;
}

export function genId(prefix = 'id'): string {
  return defaultFactory(prefix);
}

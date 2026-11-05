/** Explicit success or failure returned by parsing and IO helpers. */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Throws when the condition is falsy, narrowing the remaining code path. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Throws when a required invariant is broken. */
export function invariant(condition: unknown, message: string): asserts condition {
  assert(condition, message);
}

/** Detached copy of structured-cloneable data. */
export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

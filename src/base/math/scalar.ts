export const EPS = 1e-6;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function maxOf(values: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < values.length; i++) if (values[i]! > max) max = values[i]!;
  return max;
}

export function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function nearlyEqual(a: number, b: number, tolerance = EPS): boolean {
  return Math.abs(a - b) <= tolerance;
}

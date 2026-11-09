/** Scalar helpers with no domain dependencies. */

/** Default tolerance for geometric comparisons. */
export const EPS = 1e-6;

/** Clamps a number into [lo, hi]; infinite bounds are allowed. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Clamps a number into [0, 1]. */
export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Linear interpolation between two numbers. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Whether two numbers are within `tolerance` of each other. */
export function nearlyEqual(a: number, b: number, tolerance = EPS): boolean {
  return Math.abs(a - b) <= tolerance;
}

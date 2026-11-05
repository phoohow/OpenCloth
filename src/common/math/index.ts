/** Default tolerance for geometric comparisons. */
export const EPS = 1e-6;

/** Clamps a number into [lo, hi]; infinite bounds are allowed. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Linear interpolation between two numbers. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const degToRad = (deg: number): number => deg * Math.PI / 180;
export const radToDeg = (rad: number): number => rad * 180 / Math.PI;

/** Length of a 3D vector given by its components. */
export const hypot3 = (dx: number, dy: number, dz: number): number => Math.hypot(dx, dy, dz);

/** Distance between two xyz points stored at particle indices in a flat buffer. */
export function distance3At(positions: Float32Array, a: number, b: number): number {
  return Math.hypot(
    positions[a * 3] - positions[b * 3],
    positions[a * 3 + 1] - positions[b * 3 + 1],
    positions[a * 3 + 2] - positions[b * 3 + 2],
  );
}

/** Shape curves shared by the body landmarks and the procedural geometry. */

/**
 * Monotone cubic interpolation (Fritsch-Carlson): smooth between the knots without overshooting
 * past neighbouring values. Knots may be given in increasing or decreasing order.
 */
export function monotoneInterp(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1) return ys[0];
  // Fritsch-Carlson assumes increasing knots; reverse decreasing inputs.
  if (xs[n - 1] < xs[0]) {
    return monotoneInterp([...xs].reverse(), [...ys].reverse(), x);
  }
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  const m: number[] = [d[0]];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) { m.push(0); continue; }
    const w1 = 2 * (xs[k + 1] - xs[k]) + (xs[k] - xs[k - 1]);
    const w2 = (xs[k + 1] - xs[k]) + 2 * (xs[k] - xs[k - 1]);
    m.push((w1 * d[k - 1] + w2 * d[k]) / (w1 + w2));
  }
  m.push(d[n - 2]);
  let i = 1;
  while (i < n - 1 && xs[i] < x) i++;
  const h = xs[i] - xs[i - 1];
  const t = (x - xs[i - 1]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return ys[i - 1] * (2 * t3 - 3 * t2 + 1) + h * m[i - 1] * (t3 - 2 * t2 + t)
    + ys[i] * (-2 * t3 + 3 * t2) + h * m[i] * (t3 - t2);
}

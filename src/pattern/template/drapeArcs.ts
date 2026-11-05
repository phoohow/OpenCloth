import type { PanelDrape } from '@/model/types';

/** Torso wrap segment centered on the body front; `180` covers the front half. */
export function frontArc(spanDeg: number): Pick<PanelDrape, 'startDeg' | 'sweepDeg'> {
  return { startDeg: -spanDeg / 2, sweepDeg: spanDeg };
}

/** Torso wrap segment centered on the body back, running opposite to the front half. */
export function backArc(spanDeg: number): Pick<PanelDrape, 'startDeg' | 'sweepDeg'> {
  return { startDeg: 180 + spanDeg / 2, sweepDeg: -spanDeg };
}

/** Front-half segment following a bodice neckline edge from the right shoulder-neck point. */
export function frontArcFlipped(spanDeg: number): Pick<PanelDrape, 'startDeg' | 'sweepDeg'> {
  return { startDeg: spanDeg / 2, sweepDeg: -spanDeg };
}

/** Back-half segment following a bodice neckline edge from the right shoulder-neck point. */
export function backArcFlipped(spanDeg: number): Pick<PanelDrape, 'startDeg' | 'sweepDeg'> {
  return { startDeg: 180 - spanDeg / 2, sweepDeg: spanDeg };
}

/**
 * Wrap segment of one panel in a body half split into `perHalf` panels, counted from the
 * side seam on the front half and from the same side on the back half.
 */
export function bandArc(index: number, perHalf: number, back = false): Pick<PanelDrape, 'startDeg' | 'sweepDeg'> {
  const span = 180 / perHalf;
  return back
    ? { startDeg: 270 - index * span, sweepDeg: -span }
    : { startDeg: -90 + index * span, sweepDeg: span };
}

/** Angular span between a bodice's shoulder-neck points, given its half width. */
export function neckArcSpan(neckWidthCm: number, panelWidthCm: number): number {
  const u = neckWidthCm / 2 / panelWidthCm + 0.5;
  return Math.max(2 * (u * 180 - 90), 10);
}

/** Approximate length of a neckline curve from its half width and depth. */
export function necklineLengthCm(halfWidthCm: number, depthCm: number): number {
  const a = halfWidthCm;
  const b = depthCm;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))) / 2;
}

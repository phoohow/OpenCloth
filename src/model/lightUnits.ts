/** Brightness conversion between light types, whose intensity units differ. */

import type { LightType } from '@/model/types';
import { LIGHT_INTENSITY } from '@/model/defaults';

/**
 * Re-expresses a brightness for another light type. Each type reads intensity in its own unit,
 * so the value is scaled by the ratio of their default brightness: switching the type keeps the
 * scene roughly as bright instead of leaving it off by an order of magnitude. This is a relative
 * heuristic, not a photometric conversion.
 */
export function convertLightIntensity(from: LightType, to: LightType, value: number): number {
  if (from === to || !Number.isFinite(value)) return value;
  const ratio = LIGHT_INTENSITY[to] / LIGHT_INTENSITY[from];
  return Math.round(value * ratio * 100) / 100;
}

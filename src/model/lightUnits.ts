import type { LightType } from '@/model/types';

import { LIGHT_INTENSITY } from '@/model/defaults';

export function convertLightIntensity(from: LightType, to: LightType, value: number): number {
  if (from === to || !Number.isFinite(value)) return value;
  const ratio = LIGHT_INTENSITY[to] / LIGHT_INTENSITY[from];
  return Math.round(value * ratio * 100) / 100;
}

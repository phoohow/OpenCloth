const MIN_SPAN = 1e-6;

export function fitStop(cm: number, tightCm: number, looseCm: number): number {
  if (!Number.isFinite(cm)) return 0;
  const tight = Number.isFinite(tightCm) && tightCm > 0 ? tightCm : MIN_SPAN;
  const loose = Number.isFinite(looseCm) && looseCm > tight ? looseCm : tight + MIN_SPAN;
  if (cm <= 0) return 0;
  if (cm <= tight) return 0.3 * (cm / tight);
  if (cm <= loose) return 0.3 + 0.45 * ((cm - tight) / (loose - tight));
  return 0.75 + 0.25 * Math.min(1, (cm - loose) / loose);
}

export function bilateralStop(value: number, stretch: number, compression: number): number {
  if (!Number.isFinite(value)) return 0;
  const up = Number.isFinite(stretch) && stretch > 0 ? stretch : MIN_SPAN;
  const down = Number.isFinite(compression) && compression > 0 ? compression : MIN_SPAN;
  return value >= 0
    ? 0.5 + 0.5 * Math.min(1, value / up)
    : 0.5 - 0.5 * Math.min(1, -value / down);
}

export function strainStop(value: number, min: number, max: number): number {
  return bilateralStop(value, max, min < 0 ? -min : 0);
}

export function pressureStop(kpa: number, maxKpa: number): number {
  if (!Number.isFinite(kpa) || kpa <= 0) return 0;
  const top = Number.isFinite(maxKpa) && maxKpa > 0 ? maxKpa : MIN_SPAN;
  return Math.min(1, kpa / top);
}

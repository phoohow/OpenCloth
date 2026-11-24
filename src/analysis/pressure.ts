export const DEFAULT_PRESSURE_KPA_PER_MM = 1;

export interface PressureField {
  pressureKpa: Float32Array;
  contactVertices: number;
}

export interface PressureOptions {
  kpaPerMm?: number;
}

export interface PressurePanelRange {
  panelId: string;
  vertexOffset: number;
  vertexCount: number;
}

export interface PressurePanelStats {
  panelId: string;
  contactVertices: number;
  meanKpa: number;
  maxKpa: number;
}

export interface PressureStats {
  vertices: number;
  contactVertices: number;
  minKpa: number;
  meanKpa: number;
  maxKpa: number;
  panels: PressurePanelStats[];
}

export function computePressureField(
  moveMeters: ArrayLike<number>,
  options: PressureOptions = {},
): PressureField {
  const count = Math.floor(moveMeters.length);
  const pressureKpa = new Float32Array(count);
  const requested = options.kpaPerMm;
  const scale = typeof requested === 'number' && Number.isFinite(requested) && requested > 0
    ? requested
    : DEFAULT_PRESSURE_KPA_PER_MM;
  let contactVertices = 0;
  for (let i = 0; i < count; i++) {
    const move = moveMeters[i];
    if (typeof move !== 'number' || !Number.isFinite(move) || move <= 0) continue;
    contactVertices += 1;
    pressureKpa[i] = move * 1000 * scale;
  }

  return { pressureKpa, contactVertices };
}

export function pressureStats(
  field: PressureField,
  panels: ReadonlyArray<PressurePanelRange> = [],
): PressureStats {
  const values = field.pressureKpa;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let contactVertices = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value) || value <= 0) continue;
    contactVertices += 1;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }

  const panelStats: PressurePanelStats[] = [];
  for (const panel of panels) {
    const end = Math.min(values.length, panel.vertexOffset + panel.vertexCount);
    let count = 0;
    let panelSum = 0;
    let panelMax = 0;
    for (let i = Math.max(0, panel.vertexOffset); i < end; i++) {
      const value = values[i]!;
      if (!Number.isFinite(value) || value <= 0) continue;
      count += 1;
      panelSum += value;
      panelMax = Math.max(panelMax, value);
    }

    if (count === 0) continue;
    panelStats.push({
      panelId: panel.panelId,
      contactVertices: count,
      meanKpa: panelSum / count,
      maxKpa: panelMax,
    });
  }

  return {
    vertices: values.length,
    contactVertices,
    minKpa: contactVertices > 0 ? min : 0,
    meanKpa: contactVertices > 0 ? sum / contactVertices : 0,
    maxKpa: contactVertices > 0 ? max : 0,
    panels: panelStats,
  };
}

import type { SimulationConfig } from '@/model/types';
import type { PanelInput, PanelMesh } from '@/sim/common/types';

import { computeVertexAreas } from '@/base/geom';
import { cm2ToM2, cmToM } from '@/base/units';
import { DEFAULT_CLOTH_THICKNESS_CM, DEFAULT_LAYER_SPACING_CM } from '@/model';

export const COMPLIANCE_REFERENCE_AREA_M2 = cm2ToM2(1);

const MAX_DENSITY_SUBSTEPS = 2;

export function particleAreas(mesh: PanelMesh): Float32Array {
  const areas = computeVertexAreas(mesh.positions, mesh.indices);
  for (let i = 0; i < areas.length; i++) areas[i] = cm2ToM2(areas[i]!);
  return areas;
}

export function meanParticleAreaM2(mesh: PanelMesh): number {
  if (mesh.vertexCount <= 0) return COMPLIANCE_REFERENCE_AREA_M2;
  const shares = particleAreas(mesh);
  let total = 0;
  for (let i = 0; i < shares.length; i++) total += shares[i]!;
  return total / mesh.vertexCount;
}

export function complianceMassScale(mesh: PanelMesh): number {
  return 10 / Math.max(meanParticleAreaM2(mesh), 1e-12);
}

export function meshDensitySubsteps(panels: ReadonlyArray<Pick<PanelInput, 'mesh'>>): number {
  let finest = Infinity;
  for (const panel of panels) finest = Math.min(finest, meanParticleAreaM2(panel.mesh));
  if (!Number.isFinite(finest) || finest <= 0) return 1;
  const ratio = Math.sqrt(COMPLIANCE_REFERENCE_AREA_M2 / finest);
  return Math.min(MAX_DENSITY_SUBSTEPS, Math.max(1, ratio));
}

export function seamBreakStretch(strength: number): number {
  const s = Math.min(1, Math.max(0.01, strength));
  return 0.3 + s * 1.2;
}

export function clothThicknessMeters(config: SimulationConfig): number {
  const cm = config.clothThicknessCm;
  const value = typeof cm === 'number' && Number.isFinite(cm) ? cm : DEFAULT_CLOTH_THICKNESS_CM;
  return cmToM(Math.min(1, Math.max(0, value)));
}

export function layerSpacingMeters(config: SimulationConfig): number {
  const cm = config.layerSpacingCm;
  const value = typeof cm === 'number' && Number.isFinite(cm) ? cm : DEFAULT_LAYER_SPACING_CM;
  return cmToM(Math.min(2, Math.max(0, value)));
}

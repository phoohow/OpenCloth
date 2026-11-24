import type { FabricPhysics } from '@/model/types';
import type { ClothSimInput } from '@/sim/common';

import {
  computeParticleDamping, computeParticleFriction, computeParticleLayers, computeParticleThickness,
} from '@/sim/particles/fields';

export const NO_PANEL = 0xffffffff;

export interface LayoutTables {
  readonly panelMap: Uint32Array;
  readonly thicknessMeters: Float32Array;
  readonly layers: Uint8Array;
  readonly damping: Float32Array;
  readonly friction: Float32Array;
}

export function computeParticlePanelMap(input: ClothSimInput): Uint32Array {
  const map = new Uint32Array(input.particleCount).fill(NO_PANEL);
  input.panels.forEach((panel, slot) => {
    const end = Math.min(panel.vertexOffset + panel.mesh.vertexCount, map.length);
    for (let i = panel.vertexOffset; i < end; i++) map[i] = slot;
  });
  return map;
}

export function buildLayout(
  input: ClothSimInput,
  physics: readonly FabricPhysics[],
  fallbackThicknessMeters: number,
): LayoutTables {
  const particleCount = input.particleCount;
  const first = physics[0];
  return {
    panelMap: computeParticlePanelMap(input),
    thicknessMeters: computeParticleThickness(input, particleCount, fallbackThicknessMeters),
    layers: computeParticleLayers(input, particleCount),
    damping: computeParticleDamping(input, physics, particleCount, first?.damping ?? 0.02),
    friction: computeParticleFriction(input, physics, particleCount, first?.contactFriction ?? 0),
  };
}

export function layoutKey(input: ClothSimInput, seamPairCount: number): string {
  return [
    input.particleCount,
    input.triangleCount,
    seamPairCount,
    input.panels.map(panel => `${panel.panelId}@${panel.vertexOffset}x${panel.mesh.vertexCount}`).join(','),
  ].join('|');
}

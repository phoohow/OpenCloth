import type { ClothSimInput } from '@/sim';
import { computeVertexStrain, strainBounds, strainStats, type StrainBounds } from '@/analysis';
import { liveOr, type AnalysisChannel } from '@/analysis';

/** Strain heatmap: stretch of each merged edge against its flat-pattern rest length. */
export const strainChannel: AnalysisChannel<'strain'> = {
  kind: 'strain',
  pass(source, overlay, { min, max, byFabric }) {
    const input = source.clothInput();
    if (!input) return null;
    const rest = source.restPositions();
    const positions = liveOr(rest, source.lastGoodPositions());
    if (rest.length === 0 || positions.length === 0) return null;
    const strain = computeVertexStrain(rest, positions, input.indices);
    const bounds = byFabric ? boundsOfAssembly(input) : undefined;
    const stats = strainStats(strain, bounds);
    if (bounds) overlay.updateStrainBounds(strain, bounds);
    else overlay.updateStrain(strain, min, max);
    return stats;
  },
};

/** Per-vertex strain tolerance from every panel's fabric in the merged layout. */
function boundsOfAssembly(input: ClothSimInput): StrainBounds {
  return strainBounds(input.particleCount, input.panels.map(panel => ({
    vertexOffset: panel.vertexOffset,
    vertexCount: panel.mesh.vertexCount,
    stretchLimit: panel.physics.stretchLimit,
    compressionLimit: panel.physics.compressionLimit,
  })));
}

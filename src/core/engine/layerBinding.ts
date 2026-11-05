import type { Project } from '../model/types';
import type { ClothSimInput } from '../../sim/clothSimulator';
import { particleThicknessMeters } from '../model/layers';
import { layerThicknessSignature } from './clothSignatures';

/**
 * Keeps the solver's per-particle clearance in step with the construction layers. The values only
 * change when the layer table or a panel's layer assignment changes, so a signature guards the write.
 */
export class LayerBinding {
  private applied = '';

  /** Writes the clearance array when the layer data changed, or unconditionally when forced. */
  apply(
    project: Project, input: ClothSimInput | null, write: (values: Float32Array<ArrayBuffer>) => void, force = false,
  ): void {
    const signature = layerThicknessSignature(project);
    if (!force && signature === this.applied) return;
    this.applied = signature;
    if (!input) return;
    write(particleThicknessMeters(
      project,
      input.panels.map(panel => ({
        panelId: panel.panelId,
        vertexOffset: panel.vertexOffset,
        vertexCount: panel.mesh.vertexCount,
      })),
      input.particleCount,
    ));
  }

  /** Forgets the applied signature, so the next cloth rebuild writes the array again. */
  reset(): void {
    this.applied = '';
  }
}

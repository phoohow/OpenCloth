import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../../../src/core/model/defaults';
import { generateTShirt } from '../../../src/pattern/template/tShirtTemplate';
import type { PanelMesh } from '../../../src/pattern/panel/panelBuilder';
import type { Project } from '../../../src/core/model/types';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const { buildPanelMesh } = await import('../../../src/pattern/panel/panelBuilder');
const { MergedCloth } = await import('../../../src/core/engine/mergedCloth');
const { BodyLandmarkCache } = await import('../../../src/core/engine/initialPose');

/** The T-shirt template with every panel mesh merged into one buffer. */
function mergedTemplate(): { cloth: InstanceType<typeof MergedCloth>; panelMeshes: Map<string, PanelMesh>; panelIds: string[] } {
  const project: Project = createDefaultProject();
  project.pattern = generateTShirt();
  const resolutionCm = project.scene.simulation.meshResolutionCm ?? 2;
  const panelMeshes = new Map<string, PanelMesh>();
  for (const panelId of Object.keys(project.pattern.panels)) {
    const mesh = buildPanelMesh(project.pattern, panelId, resolutionCm);
    if (mesh) panelMeshes.set(panelId, mesh);
  }
  const cloth = new MergedCloth();
  cloth.build(project, panelMeshes, new BodyLandmarkCache());
  return { cloth, panelMeshes, panelIds: Array.from(panelMeshes.keys()) };
}

describe('merged cloth triangle data', () => {
  it('stores panel triangles as merged vertex ids', () => {
    const { cloth, panelIds } = mergedTemplate();
    expect(panelIds.length).toBeGreaterThan(1);
    for (const panelId of panelIds) {
      const [start, end] = cloth.panelRanges.get(panelId)!;
      const triangles = cloth.panelTriangles.get(panelId)!;
      expect(triangles.length).toBeGreaterThan(0);
      for (const index of triangles) {
        expect(index).toBeGreaterThanOrEqual(start);
        expect(index).toBeLessThan(end);
      }
    }
  });

  it('keeps every merged triangle mapped to its own panel', () => {
    const { cloth, panelMeshes, panelIds } = mergedTemplate();
    const owned = new Set<string | null>(cloth.trianglePanelIds);
    expect(owned.size).toBe(panelIds.length);
    let totalTriangles = 0;
    for (const panelId of panelIds) {
      totalTriangles += panelMeshes.get(panelId)!.triangleCount;
    }
    expect(cloth.trianglePanelIds.length).toBe(totalTriangles);
    for (let t = 0; t < totalTriangles; t++) {
      expect(cloth.trianglePanelIds[t]).not.toBeNull();
    }
  });

  it('selects the triangles of the listed panels in order', () => {
    const { cloth, panelIds } = mergedTemplate();
    const [first, second] = panelIds;
    const expected = [...cloth.panelTriangles.get(first)!, ...cloth.panelTriangles.get(second)!];
    expect(Array.from(cloth.overlayTriangles([first, second]))).toEqual(expected);
  });
});

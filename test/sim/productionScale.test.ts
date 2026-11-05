import { describe, expect, it } from 'vitest';
import { genId } from '@/common/id';
import { createEmptyPattern, DEFAULT_MESH_RESOLUTION_CM } from '@/model/defaults';
import type { Panel, Pattern, Vec2 } from '@/model/types';
import { buildPanelMesh } from '@/pattern/panel/panelBuilder';
import { SelfCollisionSolver } from '@/sim/selfCollision';

/** Adds one rectangular panel to the pattern and returns its id. */
function addRectPanel(pattern: Pattern, name: string, width: number, height: number): string {
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const pointIds = corners.map(pos => {
    const id = genId('pt');
    pattern.points[id] = { id, pos, kind: 'corner' };
    return id;
  });
  const edgeIds: string[] = [];
  for (let i = 0; i < pointIds.length; i++) {
    const id = genId('edge');
    pattern.edges[id] = {
      id, type: 'line', startPointId: pointIds[i]!, endPointId: pointIds[(i + 1) % pointIds.length]!,
    };
    edgeIds.push(id);
  }
  const panel: Panel = {
    id: genId('panel'),
    name,
    outlineEdgeIds: edgeIds,
    dartIds: [],
    internalLineIds: [],
    holes: [],
    seamAllowanceCm: 0,
    fabricId: 'fabric_default',
    meshResolutionCm: DEFAULT_MESH_RESOLUTION_CM,
    visible: true,
    locked: false,
  };
  pattern.panels[panel.id] = panel;
  return panel.id;
}

describe('production scale gate: 10 panels, about 5000 particles, self collision', () => {
  it('resolves the merged cloth inside a generous budget', () => {
    const pattern = createEmptyPattern();
    const panelIds = Array.from({ length: 10 }, (_, i) => addRectPanel(pattern, `片${i + 1}`, 40, 60));

    const meshes = panelIds
      .map(id => buildPanelMesh(pattern, id, 2.4))
      .filter((mesh): mesh is NonNullable<typeof mesh> => mesh !== null);
    expect(meshes).toHaveLength(10);

    const particleCount = meshes.reduce((sum, mesh) => sum + mesh.vertexCount, 0);
    expect(particleCount).toBeGreaterThanOrEqual(5000);
    expect(particleCount).toBeLessThanOrEqual(6000);

    // Superimpose the panels with a thin per-layer offset: the densest self-collision case.
    const positions = new Float32Array(particleCount * 3);
    const invMasses = new Float32Array(particleCount).fill(1);
    const layers = new Uint8Array(particleCount);
    let offset = 0;
    meshes.forEach((mesh, layer) => {
      for (let i = 0; i < mesh.vertexCount; i++) {
        positions[(offset + i) * 3] = mesh.positions2D[i * 2]! * 0.01;
        positions[(offset + i) * 3 + 1] = mesh.positions2D[i * 2 + 1]! * 0.01;
        positions[(offset + i) * 3 + 2] = layer * 0.002;
        layers[offset + i] = layer;
      }
      offset += mesh.vertexCount;
    });

    const solver = new SelfCollisionSolver(particleCount);
    const start = performance.now();
    const result = solver.resolve(positions, invMasses, layers, {
      thickness: 0.002,
      layerSpacing: 0.003,
    });
    const ms = performance.now() - start;

    expect(result.pairs).toBeGreaterThan(0);
    // Catches an accidental all-pairs blow-up; the pass normally finishes in well under this.
    expect(ms).toBeLessThan(5000);
  });
});

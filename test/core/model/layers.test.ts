import { describe, expect, it } from 'vitest';
import type { Panel } from '../../../src/core/model/types';
import { createDefaultProject } from '../../../src/core/model/defaults';
import {
  layerThicknessCm, panelCollisionLayer, panelThicknessCm, particleThicknessMeters,
} from '../../../src/core/model/layers';

/** Minimal panel record with only the fields the layer helpers read. */
function panel(layer?: Panel['layer'], collisionLayer?: number): Panel {
  return {
    id: 'p', name: 'p', outlineEdgeIds: [], dartIds: [], internalLineIds: [],
    seamAllowanceCm: 0, fabricId: 'f', meshResolutionCm: 1, visible: true, locked: false,
    layer, collisionLayer,
  };
}

describe('construction layer thickness', () => {
  it('fills missing values with defaults and clamps the range', () => {
    const project = createDefaultProject();
    project.layerThicknessCm = { shell: -1, padding: 3 };
    const thickness = layerThicknessCm(project);
    expect(thickness.shell).toBe(0);
    expect(thickness.padding).toBe(2);
    expect(thickness.lining).toBeCloseTo(0.1);
  });

  it('lets the layer set the panel clearance', () => {
    const project = createDefaultProject();
    const padding = panelThicknessCm(project, panel('padding'));
    expect(padding).toBeCloseTo(0.8);
    project.layerThicknessCm = { padding: 1.4 };
    expect(panelThicknessCm(project, panel('padding'))).toBeCloseTo(1.4);
  });

  it('falls back to the global cloth thickness for an unassigned panel', () => {
    const project = createDefaultProject();
    expect(panelThicknessCm(project, undefined)).toBeCloseTo(0.2);
    project.scene.simulation.clothThicknessCm = 0.5;
    expect(panelThicknessCm(project, panel())).toBeCloseTo(0.5);
  });
});

describe('construction layer collision order', () => {
  it('orders lining, padding and shell from the body outward', () => {
    expect(panelCollisionLayer(panel('lining'))).toBe(0);
    expect(panelCollisionLayer(panel('padding'))).toBe(1);
    expect(panelCollisionLayer(panel('shell'))).toBe(2);
  });

  it('keeps the legacy layer 0 for a panel without a construction layer', () => {
    expect(panelCollisionLayer(panel())).toBe(0);
  });

  it('lets a manual collision layer win and clamps it', () => {
    expect(panelCollisionLayer(panel('shell', 5))).toBe(5);
    expect(panelCollisionLayer(panel('lining', -3))).toBe(0);
    expect(panelCollisionLayer(panel('padding', 12))).toBe(9);
  });
});

describe('per-particle thickness', () => {
  it('spreads each panel clearance over its particle range', () => {
    const project = createDefaultProject();
    const shellId = 'shell';
    const paddingId = 'padding';
    project.pattern.panels = {
      [shellId]: { ...panel('shell'), id: shellId },
      [paddingId]: { ...panel('padding'), id: paddingId },
    };
    project.layerThicknessCm = { shell: 0.5, padding: 1.2 };
    project.scene.simulation.clothThicknessCm = 0.2;
    const values = particleThicknessMeters(project, [
      { panelId: shellId, vertexOffset: 0, vertexCount: 2 },
      { panelId: paddingId, vertexOffset: 2, vertexCount: 3 },
    ], 6);
    const expected = [0.005, 0.005, 0.012, 0.012, 0.012, 0.002];
    expected.forEach((value, i) => expect(values[i]!).toBeCloseTo(value, 6));
  });

  it('uses the global thickness outside every panel', () => {
    const project = createDefaultProject();
    project.scene.simulation.clothThicknessCm = 0.35;
    const values = particleThicknessMeters(project, [], 3);
    expect(values.length).toBe(3);
    for (const value of values) expect(value).toBeCloseTo(0.0035, 6);
  });
});

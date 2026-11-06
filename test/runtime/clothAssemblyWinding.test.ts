import { describe, expect, it } from 'vitest';
import type { Panel, PanelDrape } from '@/model/types';
import { buildPanelMesh, type PanelMesh } from '@/pattern/panel';
import { drapeReversesWinding } from '@/pattern/drape';
import { createStarterProject } from '@/pattern/template/starterProject';
import { ClothAssembly } from '@/runtime/clothAssembly';
import { BodyLandmarkCache } from '@/runtime/initialPose';

/** Panels of the starter pattern, keyed by their Chinese name. */
function starterPanels(): Record<string, Panel> {
  const project = createStarterProject();
  return Object.fromEntries(Object.values(project.pattern.panels).map(panel => [panel.name, panel]));
}

/** The panel's drape replaced, so one mapping can be checked in isolation. */
function withDrape(panel: Panel, drape: PanelDrape): Panel {
  return { ...panel, placement: undefined, drape };
}

describe('drapeReversesWinding', () => {
  it('keeps a positively swept torso wrap facing the same way as the pattern', () => {
    const front = starterPanels()['前片']!;
    expect(front.drape!.sweepDeg).toBeGreaterThan(0);
    expect(drapeReversesWinding(front)).toBe(false);
  });

  it('mirrors a torso half that wraps the other way', () => {
    const panels = starterPanels();
    expect(drapeReversesWinding(panels['后片']!)).toBe(true);
    expect(drapeReversesWinding(withDrape(panels['前片']!, { region: 'torso', startDeg: 90, sweepDeg: -180 }))).toBe(true);
    expect(drapeReversesWinding(withDrape(panels['后片']!, { region: 'torso', startDeg: 90, sweepDeg: 180 }))).toBe(false);
  });

  it('mirrors limb tubes wrapped in the positive direction', () => {
    const panels = starterPanels();
    expect(drapeReversesWinding(panels['左袖']!)).toBe(true);
    expect(drapeReversesWinding(panels['右袖']!)).toBe(true);
    for (const region of ['arm', 'leg', 'neck'] as const) {
      expect(drapeReversesWinding(withDrape(panels['左袖']!, { region, sweepDeg: 90 }))).toBe(true);
      expect(drapeReversesWinding(withDrape(panels['左袖']!, { region, sweepDeg: -90 }))).toBe(false);
    }
  });

  it('leaves flat panels alone and follows a mirroring transform scale', () => {
    const panel = starterPanels()['前片']!;
    const flat: Panel = { ...panel, drape: undefined };
    expect(drapeReversesWinding(flat)).toBe(false);
    const mirrored: Panel = {
      ...flat,
      transform: { position: { x: 0, y: 0, z: 0 }, rotationEuler: { x: 0, y: 0, z: 0 }, scale: { x: -1, y: 1, z: 1 } },
    };
    expect(drapeReversesWinding(mirrored)).toBe(true);
  });
});

describe('merged cloth winding', () => {
  it('turns every stitched side the same way in the sewn pose', () => {
    const project = createStarterProject();
    const meshes = new Map<string, PanelMesh>();
    for (const panelId of Object.keys(project.pattern.panels)) {
      const mesh = buildPanelMesh(project.pattern, panelId);
      if (mesh) meshes.set(panelId, mesh);
    }
    const assembly = new ClothAssembly();
    const input = assembly.build(project, meshes, new BodyLandmarkCache());
    expect(input).not.toBeNull();
    expect(assembly.seamPairs.length).toBeGreaterThan(0);

    // Own-side normals of the sewn pose; the underarm folds are the only places expected to oppose.
    const positions = assembly.dressPositions;
    const own = new Float64Array(input!.particleCount * 3);
    for (let t = 0; t < input!.indices.length / 3; t++) {
      const tri = [input!.indices[t * 3]!, input!.indices[t * 3 + 1]!, input!.indices[t * 3 + 2]!];
      const n = faceNormal(positions, tri[0]!, tri[1]!, tri[2]!);
      for (const i of tri) {
        own[i * 3] += n[0]; own[i * 3 + 1] += n[1]; own[i * 3 + 2] += n[2];
      }
    }

    let agreed = 0;
    for (const pair of assembly.seamPairs) {
      const dot = dot3(own, pair.p0, own, pair.p1);
      if (dot > 0) agreed++;
    }
    expect(agreed / assembly.seamPairs.length).toBeGreaterThan(0.9);
  });
});

/** Area-weighted face normal of one triangle, as a flat triple. */
function faceNormal(positions: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ux = positions[b * 3]! - positions[a * 3]!;
  const uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!;
  const uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
  const vx = positions[c * 3]! - positions[a * 3]!;
  const vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!;
  const vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/** Cosine of the angle between two stored vectors, or 0 when either is degenerate. */
function dot3(a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number): number {
  const la = Math.hypot(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!);
  const lb = Math.hypot(b[j * 3]!, b[j * 3 + 1]!, b[j * 3 + 2]!);
  if (la < 1e-12 || lb < 1e-12) return 0;
  return (a[i * 3]! * b[j * 3]! + a[i * 3 + 1]! * b[j * 3 + 1]! + a[i * 3 + 2]! * b[j * 3 + 2]!) / (la * lb);
}

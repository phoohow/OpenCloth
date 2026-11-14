import { describe, expect, it } from 'vitest';
import type { Panel, PanelDrape } from '@/model/types';
import { buildPanelMesh, type PanelMesh } from '@/pattern/panel';
import { drapeReversesWinding } from '@/pattern/drape';
import { simplifiedDepth, type SimplifiedShape } from '@/avatar/simplifiedBody';
import { createStarterProject } from '@/pattern/template/starterProject';
import { generateShirt } from '@/pattern/template/shirtTemplate';
import { generateHoodie } from '@/pattern/template/hoodieTemplate';
import { ClothAssembly } from '@/runtime/clothAssembly';
import { BodyLandmarkCache } from '@/runtime/initialPose';
import type { SeamPair } from '@/runtime/seamPair';

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
  it('keeps a front torso wrap facing the same way as the pattern', () => {
    const front = starterPanels()['前片']!;
    expect(front.drape!.zone).toBe('front');
    expect(drapeReversesWinding(front)).toBe(false);
  });

  it('mirrors a torso half that wraps the other way', () => {
    const panels = starterPanels();
    expect(drapeReversesWinding(panels['后片']!)).toBe(true);
    expect(drapeReversesWinding(withDrape(panels['前片']!, { region: 'torso', zone: 'front', flip: true }))).toBe(true);
    expect(drapeReversesWinding(withDrape(panels['后片']!, { region: 'torso', zone: 'back', flip: true }))).toBe(false);
  });

  it('turns a limb tube over once and its mirror image back', () => {
    const panels = starterPanels();
    expect(drapeReversesWinding(panels['右袖']!)).toBe(true);
    expect(drapeReversesWinding(panels['左袖']!)).toBe(false);
    for (const region of ['arm', 'leg'] as const) {
      // Both limb halves run the same way around the axis; flipping the sheet reverses it.
      expect(drapeReversesWinding(withDrape(panels['左袖']!, { region, side: 'left', zone: 'front' }))).toBe(false);
      expect(drapeReversesWinding(withDrape(panels['左袖']!, { region, side: 'left', zone: 'front', flip: true }))).toBe(true);
      expect(drapeReversesWinding(withDrape(panels['右袖']!, { region, side: 'right', zone: 'front' }))).toBe(true);
      expect(drapeReversesWinding(withDrape(panels['右袖']!, { region, side: 'right', zone: 'front', flip: true }))).toBe(false);
    }
  });

  it('turns a neck tube over on every positive wrap', () => {
    const panel = starterPanels()['左袖']!;
    expect(drapeReversesWinding(withDrape(panel, { region: 'neck', zone: 'front' }))).toBe(true);
    expect(drapeReversesWinding(withDrape(panel, { region: 'neck', zone: 'back' }))).toBe(false);
  });

  it('keeps the right hood half facing out and turns its mirror image over', () => {
    const panel = starterPanels()['左袖']!;
    expect(drapeReversesWinding(withDrape(panel, { region: 'head', zone: 'right' }))).toBe(false);
    expect(drapeReversesWinding(withDrape(panel, { region: 'head', zone: 'left' }))).toBe(true);
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

describe('merged cloth positions', () => {
  it('keeps the initial layout out of the solver live array', () => {
    const project = createStarterProject();
    const meshes = new Map<string, PanelMesh>();
    for (const panelId of Object.keys(project.pattern.panels)) {
      const mesh = buildPanelMesh(project.pattern, panelId);
      if (mesh) meshes.set(panelId, mesh);
    }
    const assembly = new ClothAssembly();
    const input = assembly.build(project, meshes, new BodyLandmarkCache())!;

    // The solver writes into the input array; the initial layout has to stay restorable.
    expect(input.positions).not.toBe(assembly.positions);
    expect(input.positions).toEqual(assembly.positions);
    input.positions[0] = 99;
    expect(assembly.positions[0]).not.toBe(99);
  });
});

describe('unsewn layout', () => {
  // The unsewn garment starts on the proxy: every wrapped panel hugs the surface it wraps, so the
  // cloth and the simplified body coincide before any seam closes.
  it('lays every wrapped panel on its proxy surface', () => {
    const project = createStarterProject();
    const meshes = new Map<string, PanelMesh>();
    for (const panelId of Object.keys(project.pattern.panels)) {
      const mesh = buildPanelMesh(project.pattern, panelId);
      if (mesh) meshes.set(panelId, mesh);
    }
    const assembly = new ClothAssembly();
    const cache = new BodyLandmarkCache();
    assembly.build(project, meshes, cache);
    const shapes = cache.resolve(project.avatar.params).bodyShapes();
    const cases: Array<{ name: string; pick: (shape: SimplifiedShape) => boolean }> = [
      {
        name: '右袖',
        pick: s => s.kind === 'limb' && s.side === 1 && s.part === 'arm',
      },
      { name: '前片', pick: s => s.kind === 'torso' },
      { name: '后片', pick: s => s.kind === 'torso' },
    ];
    for (const c of cases) {
      const panel = Object.values(project.pattern.panels).find(p => p.name === c.name)!;
      const range = assembly.layout.rangeOf(panel.id)!;
      const targets = shapes.filter(c.pick);
      let checked = 0;
      for (let i = range.start; i < range.end; i++) {
        const p: [number, number, number] = [
          assembly.positions[i * 3]!, assembly.positions[i * 3 + 1]!, assembly.positions[i * 3 + 2]!,
        ];
        const depth = Math.max(...targets.map(t => simplifiedDepth(t, p)));
        // Rows past the proxy's ends, like a hem below the pelvis, lie outside every section.
        if (depth <= -0.5) continue;
        expect(Math.abs(depth), c.name).toBeLessThan(0.002);
        checked++;
      }
      expect(checked, c.name).toBeGreaterThan(200);
    }
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

describe('template winding', () => {
  // Every piece of a drafted garment has to face the same way once sewn; a mirrored half whose
  // outline was not reversed wraps inside out.
  for (const [label, build] of [
    ['shirt', () => generateShirt(undefined, 'fabric_default')],
    ['hoodie', () => generateHoodie(undefined, 'fabric_default')],
  ] as const) {
    it(`turns every sewn ${label} side the same way`, () => {
      const project = { ...createStarterProject(), pattern: build() };
      const meshes = new Map<string, PanelMesh>();
      for (const panelId of Object.keys(project.pattern.panels)) {
        const mesh = buildPanelMesh(project.pattern, panelId);
        if (mesh) meshes.set(panelId, mesh);
      }
      const assembly = new ClothAssembly();
      const input = assembly.build(project, meshes, new BodyLandmarkCache());
      expect(input).not.toBeNull();
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
        if (dot3(own, pair.p0, own, pair.p1) > 0) agreed++;
      }
      expect(agreed / assembly.seamPairs.length).toBeGreaterThan(0.9);
    });
  }
});

describe('sleeve cap seams', () => {
  // A cap's underarm end has to land on the armhole's underarm end and its crown on the shoulder;
  // a reversed pairing crosses the threads and twists the sleeve as the seam closes.
  it('pairs every cap end with the same end of its armhole', () => {
    const project = createStarterProject();
    const meshes = new Map<string, PanelMesh>();
    for (const panelId of Object.keys(project.pattern.panels)) {
      const mesh = buildPanelMesh(project.pattern, panelId);
      if (mesh) meshes.set(panelId, mesh);
    }
    const assembly = new ClothAssembly();
    assembly.build(project, meshes, new BodyLandmarkCache());
    const positions = assembly.positions;
    const bySeam = new Map<string, SeamPair[]>();
    for (const pair of assembly.seamPairs) {
      const list = bySeam.get(pair.seamId) ?? [];
      list.push(pair);
      bySeam.set(pair.seamId, list);
    }

    let checked = 0;
    for (const [seamId, pairs] of bySeam) {
      const seam = project.pattern.seams[seamId];
      const caps = project.pattern.edges[seam?.a.edgeId ?? '']?.semantic;
      const armholes = project.pattern.edges[seam?.b.edgeId ?? '']?.semantic;
      if (caps !== 'sleeveCap' || armholes !== 'armhole') continue;
      const capY = pairs.map(pair => positions[pair.p0 * 3 + 1]!);
      const armholeY = pairs.map(pair => positions[pair.p1 * 3 + 1]!);
      expect(correlation(capY, armholeY), seamId).toBeGreaterThan(0.9);
      checked++;
    }
    expect(checked).toBe(4);
  });

  // The shirt and the hoodie are drafted from the templates rather than the starter block, and the
  // shirt seams its cap to a back armhole the yoke cuts in two.
  for (const [label, build] of [
    ['shirt', () => generateShirt(undefined, 'fabric_default')],
    ['hoodie', () => generateHoodie(undefined, 'fabric_default')],
  ] as const) {
    it(`pairs every ${label} cap end with the same end of its armhole`, () => {
      const project = { ...createStarterProject(), pattern: build() };
      const meshes = new Map<string, PanelMesh>();
      for (const panelId of Object.keys(project.pattern.panels)) {
        const mesh = buildPanelMesh(project.pattern, panelId);
        if (mesh) meshes.set(panelId, mesh);
      }
      const assembly = new ClothAssembly();
      assembly.build(project, meshes, new BodyLandmarkCache());
      const positions = assembly.positions;
      let checked = 0;
      for (const seam of Object.values(project.pattern.seams)) {
        if (project.pattern.edges[seam.a.edgeId]?.semantic !== 'sleeveCap') continue;
        if (project.pattern.edges[seam.b.edgeId]?.semantic !== 'armhole') continue;
        const pairs = assembly.seamPairs.filter(pair => pair.seamId === seam.id);
        const capY = pairs.map(pair => positions[pair.p0 * 3 + 1]!);
        const armholeY = pairs.map(pair => positions[pair.p1 * 3 + 1]!);
        // The lowest cap particle has to sit on the lowest armhole particle: the underarm ends pair.
        expect(capY.indexOf(Math.min(...capY)), seam.id).toBe(armholeY.indexOf(Math.min(...armholeY)));
        // A short interval cut by the yoke has too few particles for a correlation to mean anything.
        if (pairs.length >= 3) expect(correlation(capY, armholeY), seam.id).toBeGreaterThan(0.9);
        checked++;
      }
      expect(checked).toBeGreaterThanOrEqual(4);
    });
  }
});

describe('body pose', () => {
  it('re-reads the landmarks when the body settings change', () => {
    const cache = new BodyLandmarkCache();
    const params = createStarterProject().avatar.params;
    const a = cache.resolve({ ...params, pose: 'a' });
    const t = cache.resolve({ ...params, pose: 't' });
    expect(t).not.toBe(a);
    // T-pose lays the upper arm on the horizontal axis; the A-pose hangs it.
    expect(Math.abs(a.armChain(1).dir1[1])).toBeGreaterThan(0.5);
    expect(Math.abs(t.armChain(1).dir1[1])).toBeLessThan(0.05);
  });

  it('lays the sleeves along the arm in either pose', () => {
    const project = createStarterProject();
    const meshes = new Map<string, PanelMesh>();
    for (const panelId of Object.keys(project.pattern.panels)) {
      const mesh = buildPanelMesh(project.pattern, panelId);
      if (mesh) meshes.set(panelId, mesh);
    }
    const sleeveId = Object.values(project.pattern.panels).find(panel => panel.name === '右袖')!.id;
    const assembly = new ClothAssembly();
    const cache = new BodyLandmarkCache();
    assembly.build(project, meshes, cache);
    const a = panelSpan(assembly, sleeveId);

    project.avatar.params = { ...project.avatar.params, pose: 't' };
    assembly.build(project, meshes, cache);
    const t = panelSpan(assembly, sleeveId);

    // A horizontal arm turns the tube sideways: its height span shrinks and its length runs along x.
    expect(t.y).toBeLessThan(a.y * 0.8);
    expect(t.x).toBeGreaterThan(t.y);
    expect(a.y).toBeGreaterThan(a.x);
  });
});

/** Width and height of one panel's initial positions, in meters. */
function panelSpan(assembly: ClothAssembly, panelId: string): { x: number; y: number } {
  const range = assembly.layout.rangeOf(panelId);
  if (!range) return { x: Infinity, y: Infinity };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = range.start; i < range.end; i++) {
    minX = Math.min(minX, assembly.positions[i * 3]!);
    maxX = Math.max(maxX, assembly.positions[i * 3]!);
    minY = Math.min(minY, assembly.positions[i * 3 + 1]!);
    maxY = Math.max(maxY, assembly.positions[i * 3 + 1]!);
  }
  return { x: maxX - minX, y: maxY - minY };
}

/** Pearson correlation of two equal-length samples. */
function correlation(a: number[], b: number[]): number {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let cov = 0;
  let spreadA = 0;
  let spreadB = 0;
  for (let i = 0; i < a.length; i++) {
    cov += (a[i]! - meanA) * (b[i]! - meanB);
    spreadA += (a[i]! - meanA) ** 2;
    spreadB += (b[i]! - meanB) ** 2;
  }
  return cov / Math.sqrt(spreadA * spreadB);
}

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

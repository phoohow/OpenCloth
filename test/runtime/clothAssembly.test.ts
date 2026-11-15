import { presetPattern } from '@/pattern/template';
import { describe, expect, it } from 'vitest';
import type { Panel, PanelDrape, Seam } from '@/model/types';
import { buildPanelMesh, type PanelMesh } from '@/pattern/panel';
import { drapeReversesWinding } from '@/pattern/drape';
import { simplifiedDepth, type SimplifiedShape } from '@/avatar/simplifiedBody';
import { createStarterProject } from '@/pattern/template/starterProject';
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

  // The wrap reads one proxy section per body part and lays the piece on it, whatever the pattern
  // did with the piece's girth: nothing in the templates may lift a panel off the surface.
  it('lays every wrapped panel of the templates on the section it wraps', () => {
    const starter = createStarterProject();
    const cache = new BodyLandmarkCache();
    for (const pattern of [
      starter.pattern,
      presetPattern('shirt'),
      presetPattern('hoodie'),
      presetPattern('skirt'),
      presetPattern('dress'),
    ]) {
      const project = { ...starter, pattern };
      const meshes = new Map<string, PanelMesh>();
      for (const panelId of Object.keys(pattern.panels)) {
        const mesh = buildPanelMesh(pattern, panelId);
        if (mesh) meshes.set(panelId, mesh);
      }
      const assembly = new ClothAssembly();
      assembly.build(project, meshes, cache);
      const shapes = cache.resolve(project.avatar.params).bodyShapes();
      for (const panel of Object.values(pattern.panels)) {
        const drape = panel.drape;
        if (!drape) continue;
        const shape = sectionFor(shapes, drape.region, drape.side);
        if (!shape) continue;
        const range = assembly.layout.rangeOf(panel.id)!;
        let checked = 0;
        for (let i = range.start; i < range.end; i++) {
          const p: [number, number, number] = [
            assembly.positions[i * 3]!, assembly.positions[i * 3 + 1]!, assembly.positions[i * 3 + 2]!,
          ];
          const gap = shape.kind === 'limb' ? limbSectionGap(shape, p) : simplifiedDepth(shape, p);
          // Rows past either end of a section, like a hem below the pelvis, have no surface.
          if (gap === null || gap <= -0.5) continue;
          // A limb's section is measured by arc length along its sampled centreline; measuring a
          // chord across the elbow fillet reads a few millimetres wide of that section.
          const tolerance = shape.kind === 'limb' ? 0.003 : 0.002;
          expect(Math.abs(gap), `${panel.name}`).toBeLessThan(tolerance);
          checked++;
        }
        // A piece that wraps entirely past the section, like a collar falling above the neck, has
        // no surface of its own to sit on.
        if (checked > 0) expect(checked, panel.name).toBeGreaterThan(20);
      }
    }
  });
});

/** Proxy section a wrap region reads: the limb of its side, or the single shape of the part. */
function sectionFor(
  shapes: readonly SimplifiedShape[],
  region: NonNullable<Panel['drape']>['region'],
  side: 'left' | 'right' | undefined,
): SimplifiedShape | undefined {
  if (region === 'arm' || region === 'leg') {
    const sign = side === 'left' ? -1 : 1;
    return shapes.find(shape => shape.kind === 'limb' && shape.part === region && shape.side === sign);
  }
  if (region === 'head') return shapes.find(shape => shape.kind === 'ellipsoid');
  if (region === 'neck') return shapes.find(shape => shape.kind === 'tube' && shape.part === 'neck');
  return shapes.find(shape => shape.kind === 'torso');
}

/** Distance from a point to the limb surface across its axis, or null past either end. */
function limbSectionGap(limb: Extract<SimplifiedShape, { kind: 'limb' }>, p: readonly number[]): number | null {
  let best = Infinity;
  let radius = 0;
  for (let i = 1; i < limb.path.length; i++) {
    const a = limb.path[i - 1]!;
    const b = limb.path[i]!;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const lengthSq = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2;
    const raw = ((p[0]! - a[0]!) * ab[0]! + (p[1]! - a[1]!) * ab[1]! + (p[2]! - a[2]!) * ab[2]!) / lengthSq;
    // A point that projects off either end of the centreline has no section of its own.
    if ((i === 1 && raw < 0) || (i === limb.path.length - 1 && raw > 1)) return null;
    const t = Math.min(1, Math.max(0, raw));
    const distance = Math.hypot(
      p[0]! - (a[0]! + ab[0]! * t), p[1]! - (a[1]! + ab[1]! * t), p[2]! - (a[2]! + ab[2]! * t),
    );
    if (distance < best) {
      best = distance;
      radius = limb.radii[i - 1]! + (limb.radii[i]! - limb.radii[i - 1]!) * t;
    }
  }
  return best - radius;
}

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
    ['shirt', () => presetPattern('shirt')],
    ['hoodie', () => presetPattern('hoodie')],
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
    ['shirt', () => presetPattern('shirt')],
    ['hoodie', () => presetPattern('hoodie')],
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

describe('seam closure', () => {
  // A seam that closes has to leave both pieces on one line: a pair still apart after the collapse,
  // or two pairs whose edges bow apart between them, is the gap a dressed garment must not show.
  for (const [label, build] of [
    ['starter', () => createStarterProject().pattern],
    ['shirt', () => presetPattern('shirt')],
    ['hoodie', () => presetPattern('hoodie')],
  ] as const) {
    it(`closes every ${label} stitch pair and the seam line between them`, () => {
      const project = { ...createStarterProject(), pattern: build() };
      const meshes = new Map<string, PanelMesh>();
      for (const panelId of Object.keys(project.pattern.panels)) {
        const mesh = buildPanelMesh(project.pattern, panelId);
        if (mesh) meshes.set(panelId, mesh);
      }
      const assembly = new ClothAssembly();
      assembly.build(project, meshes, new BodyLandmarkCache());
      const closed = assembly.dressPositions;

      const bySeam = new Map<string, SeamPair[]>();
      for (const pair of assembly.seamPairs) {
        const list = bySeam.get(pair.seamId) ?? [];
        list.push(pair);
        bySeam.set(pair.seamId, list);
      }
      for (const [seamId, pairs] of bySeam) {
        for (const pair of pairs) {
          expect(distanceAt(closed, pair.p0, pair.p1), seamId).toBeLessThan(0.001);
        }
        for (let i = 1; i < pairs.length; i++) {
          const previous = pairs[i - 1]!;
          const current = pairs[i]!;
          const middle: [number, number, number] = [0, 1, 2].map(k =>
            (closed[previous.p0 * 3 + k]! + closed[current.p0 * 3 + k]!) / 2) as [number, number, number];
          expect(
            distanceToSegment(middle, closed, previous.p1, current.p1), `${seamId} #${i}`,
          ).toBeLessThan(0.004);
        }
      }
    });
  }
});

describe('seam junctions', () => {
  // One pattern edge split between several seams leaves two pieces standing on the same corner. Both
  // have to be stitched to one vertex of that edge, or closing the seams tears a wedge open there.
  // Only the shirt splits an edge (the yoke cuts the armhole and the neckline into stretches).
  for (const [label, build, splitsEdge] of [
    ['starter', () => createStarterProject().pattern, false],
    ['shirt', () => presetPattern('shirt'), true],
    ['hoodie', () => presetPattern('hoodie'), false],
  ] as const) {
    it(`stitches the ${label} split corner of an edge to one vertex`, () => {
      const project = { ...createStarterProject(), pattern: build() };
      const meshes = new Map<string, PanelMesh>();
      for (const panelId of Object.keys(project.pattern.panels)) {
        const mesh = buildPanelMesh(project.pattern, panelId);
        if (mesh) meshes.set(panelId, mesh);
      }
      const assembly = new ClothAssembly();
      assembly.build(project, meshes, new BodyLandmarkCache());
      const closed = assembly.dressPositions;
      const pattern = project.pattern;

      // Boundary vertices each seam interval uses, per side, as merged indices.
      const usage = new Map<string, Array<{ lo: number; hi: number; indices: number[] }>>();
      for (const seam of Object.values(pattern.seams) as Seam[]) {
        for (const side of ['a', 'b'] as const) {
          const edgeId = seam[side].edgeId;
          const panel = Object.values(pattern.panels)
            .find(candidate => candidate.outlineEdgeIds.includes(edgeId));
          const mesh = panel ? meshes.get(panel.id) : undefined;
          const run = mesh?.edgeVertexMap.get(edgeId);
          if (!panel || !run) continue;
          const offset = assembly.layout.rangeOf(panel.id)!.start;
          const stitched = new Set(assembly.seamPairs
            .filter(pair => pair.seamId === seam.id)
            .map(pair => (side === 'a' ? pair.p0 : pair.p1) - offset));
          const indices = run.filter(vertex => stitched.has(vertex)).map(vertex => vertex + offset);
          if (indices.length === 0) continue;
          const list = usage.get(edgeId) ?? [];
          list.push({
            lo: Math.min(seam[side].t0, seam[side].t1),
            hi: Math.max(seam[side].t0, seam[side].t1),
            indices,
          });
          usage.set(edgeId, list);
        }
      }

      let junctions = 0;
      for (const [edgeId, list] of usage) {
        const sorted = [...list].sort((a, b) => a.lo - b.lo);
        for (let i = 1; i < sorted.length; i++) {
          const before = sorted[i - 1]!;
          const after = sorted[i]!;
          if (Math.abs(before.hi - after.lo) > 1e-6) continue;
          junctions++;
          const corner = before.indices[before.indices.length - 1]!;
          const neighbour = after.indices[0]!;
          expect(neighbour, `${edgeId} split at ${before.hi.toFixed(3)}`).toBe(corner);
          expect(distanceAt(closed, corner, neighbour), edgeId).toBeLessThan(0.001);
        }
      }
      expect(junctions > 0).toBe(splitsEdge);
    });
  }
});

/** Distance between two particles of a flat xyz buffer, in meters. */
function distanceAt(positions: Float32Array, a: number, b: number): number {
  return Math.hypot(
    positions[a * 3]! - positions[b * 3]!,
    positions[a * 3 + 1]! - positions[b * 3 + 1]!,
    positions[a * 3 + 2]! - positions[b * 3 + 2]!,
  );
}

/** Distance from a point to the segment between two particles, in meters. */
function distanceToSegment(
  point: [number, number, number], positions: Float32Array, a: number, b: number,
): number {
  const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!;
  const ex = positions[b * 3]! - ax, ey = positions[b * 3 + 1]! - ay, ez = positions[b * 3 + 2]! - az;
  const lengthSquared = ex * ex + ey * ey + ez * ez;
  const projection = lengthSquared > 1e-12
    ? ((point[0] - ax) * ex + (point[1] - ay) * ey + (point[2] - az) * ez) / lengthSquared
    : 0;
  const t = Math.max(0, Math.min(1, projection));
  return Math.hypot(point[0] - (ax + ex * t), point[1] - (ay + ey * t), point[2] - (az + ez * t));
}

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

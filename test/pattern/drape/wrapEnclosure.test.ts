import { createStarterProject, templatePattern } from '@/app';
import { describe, expect, it } from 'vitest';
import { buildPanelMesh, type PanelMesh } from '@/pattern/panel';
import { DEFAULT_MESH_RESOLUTION_CM } from '@/model';
import { drapePositions, planWraps } from '@/garment';
import { bodyLandmarks } from '@/avatar/landmarks';
import { simplifiedDepth } from '@/avatar/simplifiedBody';
import { makehumanBody } from '@/avatar/makehuman/body';
import { makehumanBodyData } from '@/avatar/makehuman/data';
import type { Pattern } from '@/model/types';

function panelNamed(pattern: Pattern, name: string) {
  return Object.values(pattern.panels).find(panel => panel.name === name)!;
}

describe('wrap enclosure', () => {
  const project = createStarterProject();
  const body = bodyLandmarks(project.avatar.params);

  it('lays every sleeve on the two measured arm sections', () => {
    const shapes = body.bodyShapes();
    const elbowY = body.armChain(1).mid[1];
    let lowerChecked = 0;
    for (const pattern of [templatePattern('tshirt'), templatePattern('shirt')]) {
      const sleeve = panelNamed(pattern, '右袖');
      const mesh = buildPanelMesh(pattern, sleeve.id, DEFAULT_MESH_RESOLUTION_CM)!;
      const draped = drapePositions(mesh, sleeve, body);
      const tubes = shapes.filter(shape => shape.kind === 'limb'
        && shape.part === 'arm' && shape.side === 1);
      let checked = 0;
      for (let i = 0; i < mesh.vertexCount; i++) {
        const p: [number, number, number] = [draped[i * 3]!, draped[i * 3 + 1]!, draped[i * 3 + 2]!];
        const depth = Math.max(...tubes.map(tube => simplifiedDepth(tube, p)));
        if (depth <= -0.5) continue;
        expect(depth).toBeLessThan(0.025);
        expect(depth).toBeGreaterThan(-0.025);
        if (p[1] < elbowY) lowerChecked++;
        checked++;
      }

      expect(checked).toBeGreaterThan(200);
    }

    expect(lowerChecked).toBeGreaterThan(20);
  });

  it('keeps the sleeve columns continuous across the elbow', () => {
    const pattern = templatePattern('shirt');
    const sleeve = panelNamed(pattern, '右袖');
    const mesh = buildPanelMesh(pattern, sleeve.id, DEFAULT_MESH_RESOLUTION_CM)!;
    const draped = drapePositions(mesh, sleeve, body);
    const columns = new Map<number, number[]>();
    for (let i = 0; i < mesh.vertexCount; i++) {
      const key = Math.round(mesh.positions2D[i * 2]! * 100);
      const group = columns.get(key);
      if (group) group.push(i); else columns.set(key, [i]);
    }

    let checked = 0;
    for (const group of columns.values()) {
      group.sort((a, b) => mesh.positions2D[b * 2 + 1]! - mesh.positions2D[a * 2 + 1]!);
      for (let i = 1; i < group.length; i++) {
        const a = group[i - 1]!;
        const b = group[i]!;
        const flatStep = Math.abs(mesh.positions2D[a * 2 + 1]! - mesh.positions2D[b * 2 + 1]!) * 0.01;
        if (flatStep < 1e-6) continue;
        const step = Math.hypot(
          draped[b * 3]! - draped[a * 3]!,
          draped[b * 3 + 1]! - draped[a * 3 + 1]!,
          draped[b * 3 + 2]! - draped[a * 3 + 2]!,
        );
        expect(step).toBeLessThan(flatStep * 3);
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(200);
  });

  it('keeps the cut area of every draped panel', () => {
    const patterns = [
      project.pattern,
      templatePattern('tshirt'),
      templatePattern('shirt'),
      templatePattern('hoodie'),
      templatePattern('skirt'),
      templatePattern('dress'),
    ];
    for (const pattern of patterns) {
      for (const panel of Object.values(pattern.panels)) {
        if (!panel.drape) continue;
        const mesh = buildPanelMesh(pattern, panel.id, DEFAULT_MESH_RESOLUTION_CM);
        if (!mesh) continue;
        const ratio = drapedArea(mesh, drapePositions(mesh, panel, body)) / flatArea(mesh);
        expect(ratio, `${panel.name} ${ratio.toFixed(3)}`).toBeLessThan(panel.drape.region === 'arm' ? 1.045 : 1.01);
        expect(ratio, `${panel.name} ${ratio.toFixed(3)}`).toBeGreaterThan(0.985);
      }
    }
  });

  it('keeps the torso cylinder outside the skin', () => {
    const mesh = makehumanBody(project.avatar.params);
    const weights = makehumanBodyData().armWeights;
    const env = body.torsoEnvelopeAt();
    const centreZ = env.centre(0)[2];
    let checked = 0;
    for (let i = 0; i * 3 < mesh.positions.length; i++) {
      const y = mesh.positions[i * 3 + 1]!;
      if (y < body.crotchY - 1e-6 || y > body.shoulderTopY + 1e-6) continue;
      if (Math.max(weights[i * 2]!, weights[i * 2 + 1]!) > 0.5) continue;
      const x = mesh.positions[i * 3]!;
      const z = mesh.positions[i * 3 + 2]! - centreZ;
      expect((x / env.rx) ** 2 + (z / env.rz) ** 2).toBeLessThanOrEqual(1 + 1e-6);
      checked++;
    }

    expect(checked).toBeGreaterThan(1000);
  });

  it('covers the head with the hood halves', () => {
    const pattern = templatePattern('hoodie');
    const shapes = body.bodyShapes();
    const targets = shapes.filter(shape =>
      shape.kind === 'ellipsoid' || (shape.kind === 'tube' && shape.part === 'neck'));
    const head = shapes.find(shape => shape.kind === 'ellipsoid');
    if (!head || head.kind !== 'ellipsoid') throw new Error('head proxy missing');
    const headTop = head.centre[1] + head.radii[1];
    let checked = 0;
    for (const name of ['兜帽左片', '兜帽右片']) {
      const hood = panelNamed(pattern, name);
      const mesh = buildPanelMesh(pattern, hood.id, DEFAULT_MESH_RESOLUTION_CM)!;
      const draped = drapePositions(mesh, hood, body);
      let top = -Infinity;
      let bottom = Infinity;
      for (let i = 0; i < mesh.vertexCount; i++) {
        const p: [number, number, number] = [draped[i * 3]!, draped[i * 3 + 1]!, draped[i * 3 + 2]!];
        const depth = Math.max(...targets.map(shape => simplifiedDepth(shape, p)));
        expect(depth).toBeLessThan(0.012);
        expect(depth).toBeGreaterThan(-0.012);
        top = Math.max(top, p[1]);
        bottom = Math.min(bottom, p[1]);
        checked++;
      }

      expect(top).toBeGreaterThanOrEqual(headTop - 1e-6);
      expect(bottom).toBeLessThan(body.neckTopY + 0.03);
    }

    expect(checked).toBeGreaterThan(300);
  });

  it('drapes the pieces of a limb pair as mirror images', () => {
    const pairs = [
      { name: 'sleeves', pattern: project.pattern, left: '左袖', right: '右袖', sheet: 'moved' },
      { name: 'trouser fronts', pattern: templatePattern('pants-long'), left: '前裤片（左）', right: '前裤片（右）', sheet: 'mirrored' },
      { name: 'trouser backs', pattern: templatePattern('pants-long'), left: '后裤片（左）', right: '后裤片（右）', sheet: 'mirrored' },
    ] as const;
    for (const pair of pairs) {
      const left = panelNamed(pair.pattern, pair.left);
      const right = panelNamed(pair.pattern, pair.right);
      const leftMesh = buildPanelMesh(pair.pattern, left.id, DEFAULT_MESH_RESOLUTION_CM)!;
      const rightMesh = buildPanelMesh(pair.pattern, right.id, DEFAULT_MESH_RESOLUTION_CM)!;
      const slots = planWraps(pair.pattern);
      const leftPos = drapePositions(leftMesh, left, body, slots.get(left.id));
      const rightPos = drapePositions(rightMesh, right, body, slots.get(right.id));
      const partners = partnerVertices(leftMesh, rightMesh, pair.sheet);
      expect(partners.size, pair.name).toBeGreaterThan(50);
      for (const [leftIndex, rightIndex] of partners) {
        const gap = Math.max(
          Math.abs(leftPos[leftIndex * 3]! + rightPos[rightIndex * 3]!),
          Math.abs(leftPos[leftIndex * 3 + 1]! - rightPos[rightIndex * 3 + 1]!),
          Math.abs(leftPos[leftIndex * 3 + 2]! - rightPos[rightIndex * 3 + 2]!),
        );
        expect(gap, pair.name).toBeLessThan(1e-4);
      }
    }
  });
});

function partnerVertices(left: PanelMesh, right: PanelMesh, sheet: 'mirrored' | 'moved'): Map<number, number> {
  const midOf = (mesh: PanelMesh): number => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < mesh.vertexCount; i++) {
      min = Math.min(min, mesh.positions2D[i * 2]!);
      max = Math.max(max, mesh.positions2D[i * 2]!);
    }

    return (min + max) / 2;
  };
  const leftMid = midOf(left);
  const rightMid = midOf(right);
  const column = (x: number, y: number): string =>
    `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const byColumn = new Map<string, number>();
  for (let i = 0; i < right.vertexCount; i++) {
    byColumn.set(column(right.positions2D[i * 2]! - rightMid, right.positions2D[i * 2 + 1]!), i);
  }

  const partners = new Map<number, number>();
  for (let i = 0; i < left.vertexCount; i++) {
    const offset = left.positions2D[i * 2]! - leftMid;
    const match = byColumn.get(column(sheet === 'mirrored' ? -offset : offset, left.positions2D[i * 2 + 1]!));
    if (match !== undefined) partners.set(i, match);
  }

  return partners;
}

function flatArea(mesh: PanelMesh): number {
  let sum = 0;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const a = mesh.indices[t * 3]!;
    const b = mesh.indices[t * 3 + 1]!;
    const c = mesh.indices[t * 3 + 2]!;
    const ax = mesh.positions2D[a * 2]!;
    const ay = mesh.positions2D[a * 2 + 1]!;
    const bx = mesh.positions2D[b * 2]!;
    const by = mesh.positions2D[b * 2 + 1]!;
    const cx = mesh.positions2D[c * 2]!;
    const cy = mesh.positions2D[c * 2 + 1]!;
    sum += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  }

  return sum;
}

function drapedArea(mesh: PanelMesh, positions: Float32Array): number {
  let sum = 0;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const a = mesh.indices[t * 3]!;
    const b = mesh.indices[t * 3 + 1]!;
    const c = mesh.indices[t * 3 + 2]!;
    const ax = positions[a * 3]!;
    const ay = positions[a * 3 + 1]!;
    const az = positions[a * 3 + 2]!;
    const ux = positions[b * 3]! - ax;
    const uy = positions[b * 3 + 1]! - ay;
    const uz = positions[b * 3 + 2]! - az;
    const vx = positions[c * 3]! - ax;
    const vy = positions[c * 3 + 1]! - ay;
    const vz = positions[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    sum += Math.hypot(nx, ny, nz) / 2;
  }

  return sum * 10000;
}

describe('drape symmetry', () => {
  const project = createStarterProject();
  const body = bodyLandmarks(project.avatar.params);

  it('keeps the torso halves symmetric about the body centreline', () => {
    const panels = Object.values(project.pattern.panels).filter(panel => panel.drape?.region === 'torso');
    const corners = panels.map((panel) => {
      const mesh = buildPanelMesh(project.pattern, panel.id, DEFAULT_MESH_RESOLUTION_CM)!;
      const draped = drapePositions(mesh, panel, body);
      let left = 0;
      let right = 0;
      for (let i = 0; i < mesh.vertexCount; i++) {
        if (draped[i * 3]! < draped[left * 3]!) left = i;
        if (draped[i * 3]! > draped[right * 3]!) right = i;
      }

      return { left: draped[left * 3]!, right: draped[right * 3]! };
    });
    for (const seam of [0, 1]) {
      const xs = corners.map(corner => (seam === 0 ? corner.left : corner.right));
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.01);
    }
  });
});

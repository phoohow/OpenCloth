import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/pattern/template/starterProject';
import { generateTShirt } from '@/pattern/template/tShirtTemplate';
import { generateShirt } from '@/pattern/template/shirtTemplate';
import { generateHoodie } from '@/pattern/template/hoodieTemplate';
import { generateSkirt } from '@/pattern/template/skirtTemplate';
import { generateDress } from '@/pattern/template/dressTemplate';
import { buildPanelMesh, type PanelMesh } from '@/pattern/panel';
import { drapePositions } from '@/pattern/drape';
import { bodyLandmarks } from '@/avatar/landmarks';
import { simplifiedDepth } from '@/avatar/simplifiedBody';
import { makehumanBody } from '@/avatar/makehuman/body';
import { makehumanBodyData } from '@/avatar/makehuman/data';
import type { Pattern } from '@/model/types';

/** Panel of a generated pattern by name. */
function panelNamed(pattern: Pattern, name: string) {
  return Object.values(pattern.panels).find(panel => panel.name === name)!;
}

describe('wrap enclosure', () => {
  const project = createStarterProject();
  const body = bodyLandmarks(project.avatar.params);

  // Both sleeves follow the same two proxy sections, so a short sleeve and a long sleeve bend over
  // the measured upper arm and forearm instead of one straight shoulder-to-wrist chord.
  it('lays every sleeve on the two measured arm sections', () => {
    const shapes = body.bodyShapes();
    const elbowY = body.armChain(1).mid[1];
    let lowerChecked = 0;
    for (const pattern of [generateTShirt(undefined, 'fabric_default'), generateShirt(undefined, 'fabric_default')]) {
      const sleeve = panelNamed(pattern, '右袖');
      const mesh = buildPanelMesh(pattern, sleeve.id)!;
      const draped = drapePositions(mesh, sleeve, body);
      const tubes = shapes.filter(shape => shape.kind === 'tube'
        && (shape.part === 'upperArm' || shape.part === 'forearm') && shape.side === 1);
      let checked = 0;
      for (let i = 0; i < mesh.vertexCount; i++) {
        const p: [number, number, number] = [draped[i * 3]!, draped[i * 3 + 1]!, draped[i * 3 + 2]!];
        const depth = Math.max(...tubes.map(tube => simplifiedDepth(tube, p)));
        // Rows above the shoulder sit on the extended first section, not on either tube. The
        // rounded inner elbow can fold up to two and a half centimetres into the two straight sections.
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

  // A frame that jumps at the elbow fillet swings a whole column sideways between two rows; the
  // long shirt sleeve spans the fillet, so every column must stay continuous down the arm.
  it('keeps the sleeve columns continuous across the elbow', () => {
    const pattern = generateShirt(undefined, 'fabric_default');
    const sleeve = panelNamed(pattern, '右袖');
    const mesh = buildPanelMesh(pattern, sleeve.id)!;
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

  // The flat width of every row becomes the same circumference length, so the cloth keeps the area
  // it was cut with instead of being stretched over the body.
  it('keeps the cut area of every draped panel', () => {
    const patterns = [
      project.pattern,
      generateTShirt(undefined, 'fabric_default'),
      generateShirt(undefined, 'fabric_default'),
      generateHoodie(undefined, 'fabric_default'),
      generateSkirt(undefined, 'fabric_default'),
      generateDress(undefined, 'fabric_default'),
    ];
    for (const pattern of patterns) {
      for (const panel of Object.values(pattern.panels)) {
        if (!panel.drape) continue;
        const mesh = buildPanelMesh(pattern, panel.id);
        if (!mesh) continue;
        const ratio = drapedArea(mesh, drapePositions(mesh, panel, body)) / flatArea(mesh);
        // A tapered limb section cannot be covered by a constant-width piece without a small area
        // change; the torso, neck and hood sections stay within about 1.5 percent.
        expect(ratio, `${panel.name} ${ratio.toFixed(3)}`).toBeLessThan(panel.drape.region === 'arm' ? 1.045 : 1.01);
        expect(ratio, `${panel.name} ${ratio.toFixed(3)}`).toBeGreaterThan(0.985);
      }
    }
  });

  // The torso section must enclose the skin at every height, or the cloth cuts into the bust and
  // hips. A box-fitted ellipse fails on its diagonals; the enclosing ellipse keeps every point
  // inside with a small clearance.
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

  // The hood halves read the head proxy, not the neck ring: they crown at the skull top, reach the
  // neckline and stay on the head and neck surfaces.
  it('covers the head with the hood halves', () => {
    const pattern = generateHoodie(undefined, 'fabric_default');
    const shapes = body.bodyShapes();
    const targets = shapes.filter(shape =>
      shape.kind === 'ellipsoid' || (shape.kind === 'tube' && shape.part === 'neck'));
    const head = shapes.find(shape => shape.kind === 'ellipsoid');
    if (!head || head.kind !== 'ellipsoid') throw new Error('head proxy missing');
    const headTop = head.centre[1] + head.radii[1];
    let checked = 0;
    for (const name of ['兜帽左片', '兜帽右片']) {
      const hood = panelNamed(pattern, name);
      const mesh = buildPanelMesh(pattern, hood.id)!;
      const draped = drapePositions(mesh, hood, body);
      let top = -Infinity;
      let bottom = Infinity;
      for (let i = 0; i < mesh.vertexCount; i++) {
        const p: [number, number, number] = [draped[i * 3]!, draped[i * 3 + 1]!, draped[i * 3 + 2]!];
        const depth = Math.max(...targets.map(shape => simplifiedDepth(shape, p)));
        // The bottom ring meets the tapered neck within about a centimetre.
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

  it('mirrors the two sleeves of a symmetric body', () => {
    const left = panelNamed(project.pattern, '左袖');
    const right = panelNamed(project.pattern, '右袖');
    const leftMesh = buildPanelMesh(project.pattern, left.id)!;
    const rightMesh = buildPanelMesh(project.pattern, right.id)!;
    expect(leftMesh.vertexCount).toBe(rightMesh.vertexCount);
    const leftPos = drapePositions(leftMesh, left, body);
    const rightPos = drapePositions(rightMesh, right, body);
    for (let i = 0; i < leftMesh.vertexCount; i++) {
      expect(leftPos[i * 3]!).toBeCloseTo(-rightPos[i * 3]!, 6);
      expect(leftPos[i * 3 + 1]!).toBeCloseTo(rightPos[i * 3 + 1]!, 6);
      expect(leftPos[i * 3 + 2]!).toBeCloseTo(rightPos[i * 3 + 2]!, 6);
    }
  });
});

/** Flat area of a panel mesh, in square centimeters. */
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

/** Area of the same triangles in the draped pose, in square centimeters. */
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

  // Front and back hang on the same measured axis, so their left and right edges must be mirror
  // images. How far apart the edges sit along z is a seam: the fabric is sewn there, and a wider
  // gap only means the pattern was cut with more ease than this figure needs.
  it('keeps the torso halves symmetric about the body centreline', () => {
    const panels = Object.values(project.pattern.panels).filter(panel => panel.drape?.region === 'torso');
    const corners = panels.map((panel) => {
      const mesh = buildPanelMesh(project.pattern, panel.id)!;
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

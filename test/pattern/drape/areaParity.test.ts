import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@/pattern/template/starterProject';
import { buildPanelMesh, type PanelMesh } from '@/pattern/panel';
import { drapePositions } from '@/pattern/drape';
import { bodyLandmarks } from '@/avatar/landmarks';

/** Flat area of a panel mesh, in square centimeters. */
function flatAreaCm2(mesh: PanelMesh): number {
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
function drapedAreaCm2(mesh: PanelMesh, positions: Float32Array): number {
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
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    sum += Math.hypot(cx, cy, cz) / 2;
  }
  return sum * 10000;
}

describe('drape area', () => {
  const project = createStarterProject();
  const body = bodyLandmarks(project.avatar.params);

  // The wrap is measured out in arc length, so the piece keeps the area it was cut with and the
  // garment a designer drew is the garment the viewport shows.
  it('keeps the flat area of every draped panel', () => {
    for (const panel of Object.values(project.pattern.panels)) {
      if (!panel.drape) continue;
      const mesh = buildPanelMesh(project.pattern, panel.id);
      if (!mesh) continue;
      const draped = drapePositions(mesh, panel, body);
      expect(drapedAreaCm2(mesh, draped) / flatAreaCm2(mesh)).toBeCloseTo(1, 2);
    }
  });

  it('mirrors the two sleeves of a symmetric body', () => {
    const left = Object.values(project.pattern.panels).find(panel => panel.name === '左袖');
    const right = Object.values(project.pattern.panels).find(panel => panel.name === '右袖');
    if (!left?.drape || !right?.drape) return;
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

/** Extent of one group of draped vertices along x and z, in meters. */
function groupSpan(positions: Float32Array, group: number[]): { x: number; z: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const i of group) {
    minX = Math.min(minX, positions[i * 3]!);
    maxX = Math.max(maxX, positions[i * 3]!);
    minZ = Math.min(minZ, positions[i * 3 + 2]!);
    maxZ = Math.max(maxZ, positions[i * 3 + 2]!);
  }
  return { x: maxX - minX, z: maxZ - minZ };
}

/** Mesh vertices sharing one flat x, binned at a hundredth of a centimeter. */
function flatColumns(mesh: PanelMesh): number[][] {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < mesh.vertexCount; i++) {
    const key = Math.round(mesh.positions2D[i * 2]! * 100);
    const group = groups.get(key);
    if (group) group.push(i); else groups.set(key, [i]);
  }
  return [...groups.values()];
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
      return {
        left: draped[left * 3]!,
        right: draped[right * 3]!,
      };
    });
    for (const seam of [0, 1]) {
      const xs = corners.map(corner => (seam === 0 ? corner.left : corner.right));
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.01);
    }
  });

  // A flat vertical line on a piece has to stay vertical in 3D; a leaning wrap axis shows up as a
  // depth change along that line when the garment is seen from the side.
  it('hangs every torso panel on a vertical axis', () => {
    const env = body.torsoEnvelopeAt();
    expect(Math.abs(env.centre(body.shoulderTopY)[2] - env.centre(body.crotchY)[2])).toBeLessThan(1e-9);
    for (const panel of Object.values(project.pattern.panels)) {
      if (panel.drape?.region !== 'torso') continue;
      const mesh = buildPanelMesh(project.pattern, panel.id)!;
      const draped = drapePositions(mesh, panel, body);
      for (const column of flatColumns(mesh)) {
        const span = groupSpan(draped, column);
        expect(span.x).toBeLessThan(5e-4);
        expect(span.z).toBeLessThan(5e-4);
      }
    }
  });
});

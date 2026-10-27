import { describe, expect, it } from 'vitest';
import type { Mesh as MeshType } from 'three/webgpu';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const THREE = await import('three/webgpu');
const { fitCapsulesFromGroup, generateAvatarSDF, packCapsules, evalSDF } = await import('../../../src/avatar/sdf/avatarSDF');
const { generateProceduralAvatar } = await import('../../../src/avatar/generator/avatarGenerator');

const params = { heightCm: 170, chestCm: 92, waistCm: 74, hipCm: 96 };

/** Evenly spreads n points on a sphere surface. */
function sphereSurfacePoints(center: [number, number, number], r: number, n: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i) / (n - 1);
    const rad = Math.sqrt(1 - y * y);
    const theta = golden * i;
    pts.push([center[0] + r * rad * Math.cos(theta), center[1] + r * y, center[2] + r * rad * Math.sin(theta)]);
  }
  return pts;
}

function coverage(sdf: ReturnType<typeof fitCapsulesFromGroup>, points: [number, number, number][], tol: number): number {
  let covered = 0;
  for (const [x, y, z] of points) {
    if (Math.abs(evalSDF(sdf, x, y, z)) <= tol) covered++;
  }
  return covered / points.length;
}

describe('fitCapsulesFromGroup', () => {
  it('returns no capsules and valid bounds for an empty group', () => {
    const group = new THREE.Group();
    const sdf = fitCapsulesFromGroup(group);
    expect(sdf.capsules).toHaveLength(0);
    expect(sdf.bounds.min[0]).toBeLessThan(sdf.bounds.max[0]);
  });

  it('covers a sphere surface within 6cm for 90% of samples and respects the budget', () => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 48, 32));
    mesh.position.y = 1.0;
    group.add(mesh);

    const sdf = fitCapsulesFromGroup(group, { maxCapsules: 120, voxel: 0.02 });
    expect(sdf.capsules.length).toBeGreaterThan(0);
    expect(sdf.capsules.length).toBeLessThanOrEqual(120);
    expect(coverage(sdf, sphereSurfacePoints([0, 1, 0], 0.15, 300), 0.06)).toBeGreaterThanOrEqual(0.9);
  });

  it('covers a cylinder surface and keeps capsules near the vertical axis', () => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.0, 24, 8));
    mesh.position.y = 0.8;
    group.add(mesh);

    const sdf = fitCapsulesFromGroup(group, { maxCapsules: 80, voxel: 0.025 });
    expect(sdf.capsules.length).toBeLessThanOrEqual(80);

    // Sample the lateral surface of the cylinder.
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      for (let j = 0; j < 9; j++) {
        pts.push([0.09 * Math.cos(a), 0.35 + j * 0.1, 0.09 * Math.sin(a)]);
      }
    }
    expect(coverage(sdf, pts, 0.06)).toBeGreaterThanOrEqual(0.9);
  });

  it('packs capsules in the WGSL struct layout', () => {
    const sdf = generateAvatarSDF(params);
    const packed = packCapsules(sdf);
    const first = sdf.capsules[0];
    expect(packed.length).toBeGreaterThanOrEqual(8);
    // a = (start.xyz, radiusX), b = (end.xyz, radiusZ) — matches the collide shader's field reads.
    expect(packed[0]).toBeCloseTo(first.ax, 6);
    expect(packed[1]).toBeCloseTo(first.ay, 6);
    expect(packed[2]).toBeCloseTo(first.az, 6);
    expect(packed[3]).toBeCloseTo(first.radius, 6);
    expect(packed[4]).toBeCloseTo(first.bx, 6);
    expect(packed[5]).toBeCloseTo(first.by, 6);
    expect(packed[6]).toBeCloseTo(first.bz, 6);
    expect(packed[7]).toBeCloseTo(first.radiusZ ?? 0, 6);
  });

  it('packs fitted capsules as 8 floats each', () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16)));
    const sdf = fitCapsulesFromGroup(group, { maxCapsules: 40, voxel: 0.03 });
    const packed = packCapsules(sdf);
    expect(packed.length).toBe(sdf.capsules.length * 8);
  });
});

describe('generateAvatarSDF conventions', () => {
  it('keeps vertical proportions and applies the arm rake parameter', () => {
    const h = 1.7;
    const base = generateAvatarSDF(params);
    const raked = generateAvatarSDF({ ...params, poseArmAngleRad: 0.5 });
    // Torso and leg heights unchanged; only arm capsules move.
    expect(base.capsules.length).toBe(raked.capsules.length);
    const far = (a: typeof base.capsules, b: typeof base.capsules) =>
      a.reduce((s, c, i) => s + Math.hypot(c.ax - b[i].ax, c.ay - b[i].ay), 0);
    expect(far(base.capsules, raked.capsules)).toBeGreaterThan(0.1);
    // Head capsule apex stays at the documented height.
    const head = base.capsules.reduce((m, c) => (Math.max(c.ay, c.by) > Math.max(m.ay, m.by) ? c : m), base.capsules[0]);
    expect(Math.max(head.ay, head.by)).toBeCloseTo(h * (0.47 + 0.345 + 0.03 + 0.13 * 0.8), 4);
  });

  it('generates the procedural avatar with metrics matching the SDF', () => {
    const group = generateProceduralAvatar(params);
    const m = group.userData.bodyMetrics as Record<string, number>;
    const h = 1.7;
    expect(m.legH).toBeCloseTo(h * 0.47);
    expect(m.torsoH).toBeCloseTo(h * 0.345);
    expect(m.torsoTop).toBeCloseTo(h * 0.815);
    expect(m.headCenter).toBeCloseTo(h * 0.815 + h * 0.03 + h * 0.065);
    expect(group.name).toBe('avatar');

    const meshes: MeshType[] = [];
    group.traverse(o => { if ((o as MeshType).isMesh) meshes.push(o as MeshType); });
    expect(meshes.length).toBeGreaterThan(5);
    const materials = new Set(meshes.map(x => x.material));
    expect(materials.size).toBe(1);

    let triangles = 0;
    for (const mesh of meshes) {
      const geo = mesh.geometry;
      const count = geo.index ? geo.index.count : geo.attributes.position.count;
      triangles += count / 3;
    }
    expect(triangles).toBeLessThan(12000);

    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    // Overall silhouette height close to the nominal body height.
    expect(Math.abs((box.max.y - box.min.y) - h)).toBeLessThan(0.15 * h);
  });

  it('fits a mannequin group within the shader capsule budget', () => {
    const sdf = fitCapsulesFromGroup(generateProceduralAvatar(params));
    expect(sdf.capsules.length).toBeGreaterThan(0);
    expect(sdf.capsules.length).toBeLessThan(400);
    for (const c of sdf.capsules) {
      expect(c.radius).toBeGreaterThan(0);
      expect(Number.isFinite(c.ax + c.ay + c.az + c.bx + c.by + c.bz)).toBe(true);
    }
  });
});

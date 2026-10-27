import { describe, expect, it } from 'vitest';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const THREE = await import('three/webgpu');
const { detectFormat, countTriangles, normalizeGroup } = await import('../../src/io/modelLoader');

/** Builds a mesh whose bounding box spans the given min/max corners. */
function extentsMesh(min: [number, number, number], max: [number, number, number]) {
  const corners: number[] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        corners.push(x, y, z);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
  return new THREE.Mesh(geometry);
}

function makeGroup(meshes: ReturnType<typeof extentsMesh>[]) {
  const group = new THREE.Group();
  for (const mesh of meshes) group.add(mesh);
  return group;
}

describe('detectFormat', () => {
  it('reads the format from the extension', () => {
    expect(detectFormat('avatar.glb')).toBe('glb');
    expect(detectFormat('Avatar.GLTf')).toBe('gltf');
    expect(detectFormat('mannequin.obj')).toBe('obj');
  });

  it('ignores query strings in urls', () => {
    expect(detectFormat('http://host/path/model.glb?v=2')).toBe('glb');
  });

  it('falls back to GLB magic bytes', () => {
    const glbMagic = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
    expect(detectFormat('download', glbMagic)).toBe('glb');
  });

  it('prefers the extension over magic bytes', () => {
    const glbMagic = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
    expect(detectFormat('thing.gltf', glbMagic)).toBe('gltf');
  });

  it('throws for unrecognized formats', () => {
    expect(() => detectFormat('thing.txt')).toThrow();
    expect(() => detectFormat('thing.txt', new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

describe('countTriangles', () => {
  it('counts indexed geometry via the index buffer', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    const mesh = new THREE.Mesh(geometry);
    expect(countTriangles(mesh)).toBe(2);
  });

  it('counts non-indexed geometry via the position attribute', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(27), 3));
    const mesh = new THREE.Mesh(geometry);
    expect(countTriangles(mesh)).toBe(3);
  });

  it('sums over all meshes in a hierarchy', () => {
    const group = new THREE.Group();
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
    indexed.setIndex([0, 1, 2, 3, 4, 5]);
    const flat = new THREE.BufferGeometry();
    flat.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(27), 3));
    group.add(new THREE.Mesh(indexed), new THREE.Mesh(flat));
    expect(countTriangles(group)).toBe(5);
  });
});

describe('normalizeGroup', () => {
  it('scales to the target height, grounds on y=0 and centers x/z', () => {
    // Height 2, x in [2,4], z in [-4,-2].
    const group = makeGroup([extentsMesh([2, 1, -4], [4, 3, -2])]);
    normalizeGroup(group, { targetHeight: 1.7 });

    const box = new THREE.Box3().setFromObject(group);
    expect(box.max.y - box.min.y).toBeCloseTo(1.7, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
  });

  it('uses 1.70 as the default target height', () => {
    const group = makeGroup([extentsMesh([0, 0, 0], [1, 4, 1])]);
    normalizeGroup(group);

    const box = new THREE.Box3().setFromObject(group);
    expect(box.max.y - box.min.y).toBeCloseTo(1.7, 5);
  });

  it('disables scaling and grounding when targetHeight is 0', () => {
    const group = makeGroup([extentsMesh([2, 1, -4], [4, 3, -2])]);
    normalizeGroup(group, { targetHeight: 0 });

    expect(group.scale.x).toBe(1);
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeCloseTo(1, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
  });

  it('keeps the position untouched when centerXY is false', () => {
    const group = makeGroup([extentsMesh([2, 1, -4], [4, 3, -2])]);
    normalizeGroup(group, { targetHeight: 0, centerXY: false });

    expect(group.position.lengthSq()).toBe(0);
    expect(group.scale.x).toBe(1);
  });

  it('handles flat geometry without dividing by zero', () => {
    const group = makeGroup([extentsMesh([0, 5, 0], [2, 5, 2])]);
    normalizeGroup(group, { targetHeight: 1.7 });

    expect(Number.isFinite(group.scale.y)).toBe(true);
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeCloseTo(0, 5);
  });

  it('scales groups that already carry transforms on children', () => {
    const mesh = extentsMesh([0, 0, 0], [1, 2, 1]);
    mesh.position.set(10, 0, 0);
    const group = makeGroup([mesh]);
    normalizeGroup(group, { targetHeight: 4 });

    const box = new THREE.Box3().setFromObject(group);
    expect(box.max.y - box.min.y).toBeCloseTo(4, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
  });
});

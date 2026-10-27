import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type * as THREE from 'three/webgpu';
import { BUNDLED_AVATARS, BUNDLED_AVATAR_URL, createDefaultAvatar } from '../../../src/core/model/defaults';

// three.webgpu.js reads `self` during module evaluation.
(globalThis as unknown as { self: unknown }).self ??= globalThis;

const three = await import('three/webgpu');
const { loadModelFromFile } = await import('../../../src/io/modelLoader');

/** Reads the public-dir file a bundled avatar url points at. */
function bundledFile(url: string): File {
  const path = fileURLToPath(new URL(`../../../assets${url}`, import.meta.url));
  return new File([readFileSync(path)], url.split('/').pop() ?? 'avatar.glb');
}

function meshesOf(group: THREE.Group): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  group.traverse(node => { if ((node as THREE.Mesh).isMesh) found.push(node as THREE.Mesh); });
  return found;
}

/** Mean world-space z of every vertex whose world y falls in the band. */
function meanZInBand(group: THREE.Group, minY: number, maxY: number): number {
  group.updateMatrixWorld(true);
  const v = new three.Vector3();
  let sum = 0, count = 0;
  for (const mesh of meshesOf(group)) {
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      v.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrixWorld);
      if (v.y >= minY && v.y < maxY) { sum += v.z; count++; }
    }
  }
  return count === 0 ? NaN : sum / count;
}

describe('bundled avatar models', () => {
  for (const avatar of BUNDLED_AVATARS) {
    it(`${avatar.url} loads as a 1.70 m body standing on y = 0`, async () => {
      const loaded = await loadModelFromFile(bundledFile(avatar.url), { targetHeight: 1.7 });
      expect(loaded.format).toBe('glb');
      expect(loaded.triangleCount).toBeGreaterThan(1000);
      expect(loaded.bbox.min.y).toBeCloseTo(0, 5);
      expect(loaded.bbox.max.y).toBeCloseTo(1.7, 5);
    });

    it(`${avatar.url} is untextured and faces +Z`, async () => {
      const loaded = await loadModelFromFile(bundledFile(avatar.url), { targetHeight: 1.7 });
      const meshes = meshesOf(loaded.group);
      expect(meshes.length).toBeGreaterThan(0);
      for (const mesh of meshes) expect(mesh.material).toMatchObject({ map: null, emissiveMap: null });
      // Toes sit in front of the ankles only when the body faces +Z.
      expect(meanZInBand(loaded.group, 0, 0.08)).toBeGreaterThan(meanZInBand(loaded.group, 0.3, 0.6));
    });
  }

  it('defaults to the first bundled model', () => {
    expect(createDefaultAvatar()).toMatchObject({ source: 'glb', glbUrl: BUNDLED_AVATAR_URL });
    expect(BUNDLED_AVATAR_URL).toBe(BUNDLED_AVATARS[0].url);
  });
});

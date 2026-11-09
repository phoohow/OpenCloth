import { describe, expect, it } from 'vitest';
import {
  Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute,
} from 'three/webgpu';
import type { Object3D } from 'three/webgpu';
import { meshTrianglesFromObject } from '@/render/backend/assets/avatarMeshCollider';

describe('meshTrianglesFromObject', () => {
  /** Root stand-in whose traversal yields the given objects. */
  function fakeRoot(objects: unknown[]): Object3D {
    return {
      updateMatrixWorld: () => {},
      traverse: (fn: (obj: unknown) => void) => objects.forEach(fn),
    } as unknown as Object3D;
  }

  it('bakes bone-transformed triangles from a skinned mesh', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const bone = new Bone();
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    mesh.add(bone);
    mesh.updateMatrixWorld(true);
    mesh.bind(new Skeleton([bone]));
    const root = new Group();
    root.add(mesh);
    root.updateMatrixWorld(true);

    expect(Array.from(meshTrianglesFromObject(root))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);

    bone.rotation.z = Math.PI / 2;
    root.updateMatrixWorld(true);
    const posed = meshTrianglesFromObject(root);
    expect(posed[3]).toBeCloseTo(0, 5);
    expect(posed[4]).toBeCloseTo(1, 5);
  });

  it('skips objects that are not meshes and meshes without positions', () => {
    const triangles = meshTrianglesFromObject(fakeRoot([
      { isMesh: false },
      { isMesh: true, geometry: { attributes: {} } },
      {
        isMesh: true,
        matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        geometry: {
          attributes: { position: { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), count: 3 } },
          index: null,
        },
      },
    ]));
    expect(Array.from(triangles)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
});

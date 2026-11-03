import { describe, expect, it } from 'vitest';
import type { Object3D } from 'three/webgpu';
import { meshColliderFromObject, meshTrianglesFromObject } from '../../../src/core/engine/avatarMeshCollider';

describe('meshColliderFromObject', () => {
  /** Object3D stand-in exposing only what the extraction reads. */
  function fakeObject(array: number[], elements: number[], indexed: boolean): Object3D {
    const mesh = {
      isMesh: true,
      matrixWorld: { elements },
      geometry: {
        attributes: { position: { array: new Float32Array(array), count: array.length / 3 } },
        index: indexed ? { count: 3, getX: (i: number) => [0, 1, 2][i] } : null,
      },
    };
    return {
      updateMatrixWorld: () => {},
      traverse: (fn: (obj: unknown) => void) => fn(mesh),
    } as unknown as Object3D;
  }

  it('bakes world-space triangles from a mesh', () => {
    const collider = meshColliderFromObject(fakeObject([0, 0, 0, 1, 0, 0, 0, 1, 0], [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ], false));
    expect(collider!.triangleCount).toBe(1);
    expect(Array.from(collider!.vertices)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('applies the world matrix of the mesh', () => {
    const collider = meshColliderFromObject(fakeObject([0, 0, 0, 1, 0, 0, 0, 1, 0], [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1,
    ], true));
    expect(Array.from(collider!.vertices)).toEqual([2, 3, 4, 3, 3, 4, 2, 4, 4]);
  });
});

describe('meshTrianglesFromObject', () => {
  /** Root stand-in whose traversal yields the given objects. */
  function fakeRoot(objects: unknown[]): Object3D {
    return {
      updateMatrixWorld: () => {},
      traverse: (fn: (obj: unknown) => void) => objects.forEach(fn),
    } as unknown as Object3D;
  }

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

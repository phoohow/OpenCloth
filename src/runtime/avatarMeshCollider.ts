import { Vector3 } from 'three/webgpu';
import type { BufferAttribute, Matrix4, Object3D } from 'three/webgpu';
import { buildMeshCollider, type MeshCollider } from '@/avatar/collider';

/** Structural view of a mesh; skinned meshes additionally expose a bone transform. */
interface MeshLike {
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  applyBoneTransform?: (index: number, target: Vector3) => Vector3;
  geometry?: {
    attributes?: Record<string, { array: ArrayLike<number>; count: number; fromBufferAttribute?(i: number, v: Vector3): void } | undefined>;
    index?: { count: number; getX(i: number): number } | null;
  };
  matrixWorld: Matrix4;
}

/** One mesh in the traversal, with the world matrix that places its vertices. */
interface MeshEntry {
  mesh: MeshLike;
  elements: ArrayLike<number>;
  skinned: boolean;
}

/** Skinned vertex scratch, reused across every triangle. */
const skinnedVertex = new Vector3();

/** World-space triangles of every mesh under `root`, nine floats per triangle. */
export function meshTrianglesFromObject(root: Object3D): Float32Array {
  root.updateMatrixWorld(true);
  const meshes: MeshEntry[] = [];
  let count = 0;
  root.traverse((obj) => {
    const mesh = obj as unknown as MeshLike;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const position = mesh.geometry.attributes.position;
    const index = mesh.geometry.index;
    const triangles = Math.floor((index ? index.count : position.count) / 3);
    if (triangles === 0) return;
    const skinned = mesh.isSkinnedMesh === true
      && typeof mesh.applyBoneTransform === 'function'
      && mesh.geometry.attributes.skinIndex !== undefined
      && mesh.geometry.attributes.skinWeight !== undefined;
    meshes.push({ mesh, elements: obj.matrixWorld.elements as unknown as ArrayLike<number>, skinned });
    count += triangles;
  });

  const out = new Float32Array(count * 9);
  let w = 0;
  for (const { mesh, elements, skinned } of meshes) {
    const position = mesh.geometry!.attributes!.position!;
    const index = mesh.geometry!.index;
    const array = position.array;
    const e = elements;
    const vertex = (i: number, out3: number): void => {
      if (skinned) {
        skinnedVertex.fromBufferAttribute(position as unknown as BufferAttribute, i);
        mesh.applyBoneTransform!(i, skinnedVertex);
        skinnedVertex.applyMatrix4(mesh.matrixWorld);
        out[w + out3] = skinnedVertex.x;
        out[w + out3 + 1] = skinnedVertex.y;
        out[w + out3 + 2] = skinnedVertex.z;
        return;
      }
      const x = array[i * 3], y = array[i * 3 + 1], z = array[i * 3 + 2];
      out[w + out3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      out[w + out3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      out[w + out3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    };
    const total = index ? index.count : position.count;
    for (let i = 0; i + 2 < total; i += 3) {
      vertex(index ? index.getX(i) : i, 0);
      vertex(index ? index.getX(i + 1) : i + 1, 3);
      vertex(index ? index.getX(i + 2) : i + 2, 6);
      w += 9;
    }
  }
  return out;
}

/** Collision grid built from a scene object's meshes, or null when it holds no triangles. */
export function meshColliderFromObject(root: Object3D, margin = 0): MeshCollider | null {
  return buildMeshCollider(meshTrianglesFromObject(root), undefined, margin);
}

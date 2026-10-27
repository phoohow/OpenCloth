import * as THREE from 'three/webgpu';
import type { ObjectTransform } from '../model/types';

/** Copies a project transform onto a scene group. */
export function applyTransform(group: THREE.Group, t: ObjectTransform): void {
  group.position.set(t.position.x, t.position.y, t.position.z);
  group.rotation.set(t.rotationEuler.x, t.rotationEuler.y, t.rotationEuler.z);
  group.scale.set(t.scale.x, t.scale.y, t.scale.z);
}

/** Scales and rotates a vertex buffer around its own centre, then translates it. */
export function applyObjectTransform(positions: Float32Array, t: ObjectTransform): void {
  if (isIdentity(t) || positions.length < 3) return;

  const count = positions.length / 3;
  const centre = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    centre.x += positions[i * 3]; centre.y += positions[i * 3 + 1]; centre.z += positions[i * 3 + 2];
  }
  centre.divideScalar(count);

  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(t.rotationEuler.x, t.rotationEuler.y, t.rotationEuler.z),
  );
  const move = new THREE.Vector3(t.position.x, t.position.y, t.position.z);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).sub(centre);
    v.x *= t.scale.x; v.y *= t.scale.y; v.z *= t.scale.z;
    v.applyQuaternion(quat).add(centre).add(move);
    positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
  }
}

/** True when a transform leaves geometry exactly where it is. */
function isIdentity(t: ObjectTransform): boolean {
  return !t.position.x && !t.position.y && !t.position.z
    && !t.rotationEuler.x && !t.rotationEuler.y && !t.rotationEuler.z
    && t.scale.x === 1 && t.scale.y === 1 && t.scale.z === 1;
}

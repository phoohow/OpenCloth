import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SoftBodyDeformer } from '@/render/backend/assets/softBody';

const MAX_DEPTH_M = 0.008;
const POSE_SHIFT_M = 0.1;

function torso(): { root: THREE.Group; mesh: THREE.Mesh; rest: Float32Array } {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.4, 1.8, 0.2, 4, 20, 1);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.y = 0.9;
  root.add(mesh);
  root.updateMatrixWorld(true);
  const rest = Float32Array.from(geometry.getAttribute('position').array as Float32Array);
  return { root, mesh, rest };
}

function contact(): { positions: Float32Array; move: Float32Array } {
  return { positions: new Float32Array([0, 1.2, 0.1]), move: new Float32Array([0.02]) };
}

function dentDepth(mesh: THREE.Mesh, base: Float32Array): number {
  const posed = mesh.geometry.getAttribute('position').array as Float32Array;
  let depth = 0;
  for (let i = 0; i < posed.length; i += 3) {
    depth = Math.max(
      depth,
      Math.hypot(posed[i]! - base[i]!, posed[i + 1]! - base[i + 1]!, posed[i + 2]! - base[i + 2]!),
    );
  }

  return depth;
}

function shift(rest: Float32Array, by: number): Float32Array {
  const posed = Float32Array.from(rest);
  for (let i = 1; i < posed.length; i += 3) posed[i] = posed[i]! + by;
  return posed;
}

describe('SoftBodyDeformer', () => {
  it('lays the dent on the pose it is given instead of its attach-time shape', () => {
    const { root, mesh, rest } = torso();
    const deformer = new SoftBodyDeformer();
    deformer.attach(root);
    deformer.setEnabled(true);
    const cloth = contact();
    const posed = shift(rest, POSE_SHIFT_M);
    const surface = mesh.geometry.getAttribute('position').array as Float32Array;

    let dented = false;
    for (let frame = 0; frame < 40; frame++) {
      surface.set(posed);
      deformer.rebase();
      if (deformer.update(cloth.positions, cloth.move)) dented = true;
    }

    expect(dented).toBe(true);
    expect(dentDepth(mesh, posed)).toBeLessThanOrEqual(MAX_DEPTH_M * 1.2);
  });

  it('returns the surface to the pose it was re-based on', () => {
    const { root, mesh, rest } = torso();
    const deformer = new SoftBodyDeformer();
    deformer.attach(root);
    deformer.setEnabled(true);
    const cloth = contact();
    const posed = shift(rest, POSE_SHIFT_M);
    const surface = mesh.geometry.getAttribute('position').array as Float32Array;

    for (let frame = 0; frame < 10; frame++) {
      surface.set(posed);
      deformer.rebase();
      deformer.update(cloth.positions, cloth.move);
    }

    expect(dentDepth(mesh, posed)).toBeGreaterThan(0.001);

    deformer.restore();
    expect(dentDepth(mesh, posed)).toBeLessThan(1e-6);
  });
});

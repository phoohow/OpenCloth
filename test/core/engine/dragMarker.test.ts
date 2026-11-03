import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { DragMarker } from '../../../src/core/engine/dragMarker';

/** Particle positions in meters, one every centimetre along +X. */
function row(count: number): Float32Array {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) positions[i * 3] = i / 100;
  return positions;
}

/** Camera looking at the origin from +Z, used for the billboarding test. */
function camera(): THREE.PerspectiveCamera {
  const view = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  view.position.set(0, 0, 2);
  view.lookAt(0, 0, 0);
  view.updateMatrixWorld();
  return view;
}

describe('DragMarker', () => {
  it('puts a ring on the grabbed particle and follows it', () => {
    const scene = new THREE.Scene();
    const marker = new DragMarker();
    const positions = row(5);

    marker.show(2, positions, scene, camera());
    expect(marker.particleIndex).toBe(2);
    const group = scene.children[0] as THREE.Group;
    expect(group).toBeDefined();
    expect(group.position.x).toBeCloseTo(0.02);

    positions[2 * 3] = 0.5;
    marker.sync(positions, camera());
    expect(group.position.x).toBeCloseTo(0.5);
    marker.dispose(scene);
  });

  it('turns the ring toward the camera so it stays a circle', () => {
    const scene = new THREE.Scene();
    const marker = new DragMarker();
    const view = camera();
    marker.show(0, row(3), scene, view);
    const group = scene.children[0] as THREE.Group;
    expect(group.quaternion.equals(view.quaternion)).toBe(true);
    marker.dispose(scene);
  });

  it('removes the ring when the drag ends and can show it again', () => {
    const scene = new THREE.Scene();
    const marker = new DragMarker();
    const positions = row(4);

    marker.show(1, positions, scene, camera());
    marker.hide(scene);
    expect(marker.particleIndex).toBeNull();
    expect(scene.children).toHaveLength(0);

    marker.show(3, positions, scene, camera());
    expect(scene.children).toHaveLength(1);
    marker.dispose(scene);
    expect(scene.children).toHaveLength(0);
  });

  it('does nothing while no point is grabbed', () => {
    const scene = new THREE.Scene();
    const marker = new DragMarker();
    marker.sync(row(3), camera());
    expect(scene.children).toHaveLength(0);
    expect(marker.particleIndex).toBeNull();
    marker.dispose(scene);
  });

  it('ignores a particle index outside the position buffer', () => {
    const scene = new THREE.Scene();
    const marker = new DragMarker();
    marker.show(99, row(3), scene, camera());
    const group = scene.children[0] as THREE.Group;
    expect(group.position.x).toBe(0);
    marker.dispose(scene);
  });
});

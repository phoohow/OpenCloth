import * as THREE from 'three/webgpu';
import type { SceneSlot } from '@/render';

/** Ring radius in meters. It marks the grabbed point, not the whole grab area, so it stays small. */
const RING_INNER_M = 0.0085;
const RING_OUTER_M = 0.0115;
/** Core dot radius, marking the exact particle the pull is anchored to. */
const CORE_RADIUS_M = 0.0025;

/**
 * Marker for the particle a pointer drag is pulling: a camera-facing ring plus a solid core, drawn
 * on top of the cloth so the grabbed point stays visible while it follows the fabric.
 */
export class DragMarker {
  private group: THREE.Group | null = null;
  /** Particle the marker follows, or null while nothing is grabbed. */
  private index: number | null = null;
  private ringGeometry = new THREE.RingGeometry(RING_INNER_M, RING_OUTER_M, 28);
  private coreGeometry = new THREE.SphereGeometry(CORE_RADIUS_M, 12, 10);
  private material = new THREE.MeshBasicMaterial({
    color: 0x59dcff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
    // The ring must stay readable when the cloth folds over it.
    depthTest: false,
  });

  /** Particle the marker currently follows, or null. */
  get particleIndex(): number | null {
    return this.index;
  }

  /** Starts following `particleIndex`, placing the ring at its current position. */
  show(particleIndex: number, positions: Float32Array | null, scene: SceneSlot, camera: THREE.Camera): void {
    this.index = particleIndex;
    if (!this.group) {
      const group = new THREE.Group();
      group.renderOrder = 10;
      const ring = new THREE.Mesh(this.ringGeometry, this.material);
      ring.renderOrder = 10;
      const core = new THREE.Mesh(this.coreGeometry, this.material);
      core.renderOrder = 11;
      group.add(ring, core);
      scene.add(group);
      this.group = group;
    }
    this.sync(positions, camera);
  }

  /** Keeps the marker on its particle after a readback, and turns it toward the camera. */
  sync(positions: Float32Array | null, camera: THREE.Camera): void {
    const group = this.group;
    const index = this.index;
    if (!group || index === null || !positions) return;
    const offset = index * 3;
    if (offset + 2 >= positions.length) return;
    group.position.set(positions[offset]!, positions[offset + 1]!, positions[offset + 2]!);
    group.quaternion.copy(camera.quaternion);
  }

  /** Stops following and removes the marker from the scene. */
  hide(scene: SceneSlot): void {
    this.index = null;
    if (!this.group) return;
    scene.remove(this.group);
    this.group = null;
  }

  /** Removes the marker and frees the geometry and material it owns. */
  dispose(scene: SceneSlot): void {
    this.hide(scene);
    this.ringGeometry.dispose();
    this.coreGeometry.dispose();
    this.material.dispose();
  }
}

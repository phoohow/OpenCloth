import * as THREE from 'three/webgpu';
import type { StageSlot } from '@/render';

/** Small spheres marking pinned cloth particles. */
export class PinMarkers {
  private markers: Map<number, THREE.Mesh> = new Map();
  /** 7 mm radius: about half a fingertip, so a row of pins still reads as separate dots. */
  private geometry = new THREE.SphereGeometry(0.007, 10, 8);
  private material = new THREE.MeshBasicMaterial({ color: 0xffd24a });
  /** Larger red variant used to show which pin a hover would remove. */
  private highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xff5a5a });
  private highlighted: number | null = null;
  /** Scale a highlighted marker keeps so it reads at a glance. */
  private static readonly HIGHLIGHT_SCALE = 1.7;

  /** Places a marker on a particle; a null buffer leaves it at the scene origin. */
  add(particleIndex: number, positions: Float32Array | null, scene: StageSlot): void {
    if (this.markers.has(particleIndex)) return;
    const marker = new THREE.Mesh(this.geometry, this.material);
    if (positions) this.placeMarker(marker, particleIndex, positions);
    scene.add(marker);
    this.markers.set(particleIndex, marker);
  }

  remove(particleIndex: number, scene: StageSlot): void {
    const marker = this.markers.get(particleIndex);
    if (!marker) return;
    scene.remove(marker);
    this.markers.delete(particleIndex);
    if (this.highlighted === particleIndex) this.highlighted = null;
  }

  /**
   * Marks one pin as the target of the next click: it turns red and grows, so the pointer cursor
   * and the cloth agree on what would be removed. Null restores the plain marker.
   */
  highlight(particleIndex: number | null): void {
    if (this.highlighted === particleIndex) return;
    const previous = this.highlighted === null ? null : this.markers.get(this.highlighted);
    if (previous) {
      previous.material = this.material;
      previous.scale.setScalar(1);
    }
    this.highlighted = null;
    const marker = particleIndex === null ? null : this.markers.get(particleIndex);
    if (marker) {
      marker.material = this.highlightMaterial;
      marker.scale.setScalar(PinMarkers.HIGHLIGHT_SCALE);
      this.highlighted = particleIndex;
    }
  }

  /** Particle index currently highlighted, or null. */
  highlightedIndex(): number | null {
    return this.highlighted;
  }

  /** Keeps markers on their particles after a simulation readback. */
  sync(positions: Float32Array): void {
    for (const [particleIndex, marker] of this.markers) this.placeMarker(marker, particleIndex, positions);
  }

  /** Removes all markers from the scene. */
  clear(scene: StageSlot): void {
    for (const [, marker] of this.markers) scene.remove(marker);
    this.markers.clear();
    this.highlighted = null;
  }

  /** Particle indices that currently have a marker. */
  list(): number[] {
    return Array.from(this.markers.keys());
  }

  /** Clears the markers and frees the geometry and material they share. */
  dispose(scene: StageSlot): void {
    this.clear(scene);
    this.geometry.dispose();
    this.material.dispose();
    this.highlightMaterial.dispose();
  }

  private placeMarker(marker: THREE.Mesh, particleIndex: number, positions: Float32Array): void {
    marker.position.set(
      positions[particleIndex * 3],
      positions[particleIndex * 3 + 1],
      positions[particleIndex * 3 + 2],
    );
  }
}

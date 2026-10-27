import * as THREE from 'three/webgpu';

/** Small spheres marking pinned cloth particles. */
export class PinMarkers {
  private markers: Map<number, THREE.Mesh> = new Map();
  private geometry = new THREE.SphereGeometry(0.012, 12, 10);
  private material = new THREE.MeshBasicMaterial({ color: 0xffd24a });

  /** Places a marker on a particle; a null buffer leaves it at the scene origin. */
  add(particleIndex: number, positions: Float32Array | null, scene: THREE.Scene): void {
    if (this.markers.has(particleIndex)) return;
    const marker = new THREE.Mesh(this.geometry, this.material);
    if (positions) this.placeMarker(marker, particleIndex, positions);
    scene.add(marker);
    this.markers.set(particleIndex, marker);
  }

  remove(particleIndex: number, scene: THREE.Scene): void {
    const marker = this.markers.get(particleIndex);
    if (!marker) return;
    scene.remove(marker);
    this.markers.delete(particleIndex);
  }

  /** Keeps markers on their particles after a simulation readback. */
  sync(positions: Float32Array): void {
    for (const [particleIndex, marker] of this.markers) this.placeMarker(marker, particleIndex, positions);
  }

  /** Removes all markers from the scene. */
  clear(scene: THREE.Scene): void {
    for (const [, marker] of this.markers) scene.remove(marker);
    this.markers.clear();
  }

  /** Particle indices that currently have a marker. */
  list(): number[] {
    return Array.from(this.markers.keys());
  }

  /** Clears the markers and frees the geometry and material they share. */
  dispose(scene: THREE.Scene): void {
    this.clear(scene);
    this.geometry.dispose();
    this.material.dispose();
  }

  private placeMarker(marker: THREE.Mesh, particleIndex: number, positions: Float32Array): void {
    marker.position.set(
      positions[particleIndex * 3],
      positions[particleIndex * 3 + 1],
      positions[particleIndex * 3 + 2],
    );
  }
}

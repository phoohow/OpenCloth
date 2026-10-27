import * as THREE from 'three/webgpu';
import { CLOTH_OVERLAY_NAME } from './clothConstants';

/** Translucent triangle overlay marking the selected panels; shares the cloth mesh attributes. */
export class SelectionOverlay {
  private mesh: THREE.Mesh | null = null;
  private ids: string[] = [];
  private key = '';
  private material = new THREE.MeshBasicMaterial({
    color: 0xffd400, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false,
  });

  /** Selected panel ids, in selection order. */
  getSelected(): string[] {
    return this.ids;
  }

  /** Rebuilds the overlay for these panels; an empty list clears it. Identical lists are ignored. */
  apply(scene: THREE.Scene, clothGeometry: THREE.BufferGeometry | null, panelIds: string[], triangles: Uint32Array): void {
    const key = panelIds.join('|');
    if (key === this.key) return;
    this.clear(scene);
    this.key = key;
    this.ids = panelIds;
    if (!clothGeometry || panelIds.length === 0) return;

    // The overlay shares the merged position/normal attributes so it follows the simulation for free.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', clothGeometry.getAttribute('position'));
    geometry.setAttribute('normal', clothGeometry.getAttribute('normal'));
    geometry.setAttribute('uv', clothGeometry.getAttribute('uv'));
    geometry.setIndex(new THREE.BufferAttribute(triangles, 1));
    const overlay = new THREE.Mesh(geometry, this.material);
    overlay.renderOrder = 2;
    overlay.name = CLOTH_OVERLAY_NAME;
    scene.add(overlay);
    this.mesh = overlay;
  }

  /** Takes the overlay out of the scene and forgets the selection. */
  clear(scene: THREE.Scene): void {
    if (this.mesh) scene.remove(this.mesh);
    this.mesh = null;
    this.key = '';
    this.ids = [];
  }

  /** Frees the overlay material; the shared geometry attributes belong to the cloth. */
  dispose(scene: THREE.Scene): void {
    this.clear(scene);
    this.material.dispose();
  }
}

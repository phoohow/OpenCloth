import * as THREE from 'three/webgpu';
import { fitColor, type FitField } from '@/analysis';
import { pressureColor } from '@/analysis';
import { strainColor, type StrainBounds } from '@/analysis';

/** Coloured copy of the cloth geometry that shows body clearance as a heatmap. */
export class FitOverlay {
  readonly mesh: THREE.Mesh;
  private colorAttr: THREE.BufferAttribute;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(geometry: THREE.BufferGeometry) {
    const count = geometry.getAttribute('position').count;
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('color', this.colorAttr);

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'fit-overlay';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Repeats the heatmap material so per-panel geometry groups keep hiding hidden panels. */
  setSlotCount(count: number): void {
    const slots = Math.max(1, count);
    this.mesh.material = Array.from({ length: slots }, () => this.material);
  }

  /** Writes clearance colours into the shared geometry and shows the overlay. */
  update(field: FitField): void {
    const colors = this.colorAttr.array as Float32Array;
    for (let i = 0; i < field.clearanceCm.length; i++) {
      const [r, g, b] = fitColor(field.clearanceCm[i]!, field.thresholds);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    this.colorAttr.needsUpdate = true;
  }

  /** Writes strain colours into the shared geometry, mapped over the given stretch range. */
  updateStrain(strain: Float32Array, min: number, max: number): void {
    const colors = this.colorAttr.array as Float32Array;
    for (let i = 0; i < strain.length && i < colors.length / 3; i++) {
      const [r, g, b] = strainColor(strain[i]!, min, max);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    this.colorAttr.needsUpdate = true;
  }

  /** Writes strain colours with each vertex's own fabric tolerance as the ramp end. */
  updateStrainBounds(strain: Float32Array, bounds: StrainBounds): void {
    const colors = this.colorAttr.array as Float32Array;
    const count = Math.min(strain.length, bounds.stretch.length, bounds.compression.length);
    for (let i = 0; i < count && i < colors.length / 3; i++) {
      const [r, g, b] = strainColor(strain[i]!, -bounds.compression[i]!, bounds.stretch[i]!);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    this.colorAttr.needsUpdate = true;
  }

  /** Writes estimated contact pressure colours, neutral where the vertex is not touching. */
  updatePressure(pressureKpa: Float32Array, maxKpa: number): void {
    const colors = this.colorAttr.array as Float32Array;
    for (let i = 0; i < pressureKpa.length && i < colors.length / 3; i++) {
      const [r, g, b] = pressureColor(pressureKpa[i]!, maxKpa);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    this.colorAttr.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  dispose(): void {
    this.material.dispose();
  }
}

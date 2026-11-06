import * as THREE from 'three/webgpu';
import { FitOverlay } from '@/render/scene/objects/fitOverlay';
import type { StageSlot } from '@/render/scene/manager';

/** Index range and material slot of one cloth geometry group. */
export interface SurfaceGroup {
  start: number;
  count: number;
  slot: number;
}

/**
 * The shared cloth geometry and the two layers drawn over it: the fabric mesh and the heatmap
 * overlay. Both read the same position, normal, colour and group buffers, so this object owns them
 * and keeps the layers in sync; neither layer needs to know about the other.
 */
export class ClothSurface {
  readonly geometry: THREE.BufferGeometry;
  readonly fabric: THREE.Mesh;
  readonly overlay: FitOverlay;
  private positionAttr: THREE.BufferAttribute;
  private normalAttr: THREE.BufferAttribute;
  /** One material per geometry group slot, so each pattern piece can wear its own fabric. */
  private materials: THREE.Material[] = [];

  constructor(
    private readonly slot: StageSlot,
    // Flat xyz triples.
    initialPositions: Float32Array,
    indices: Uint32Array,
    // Flat uv pairs.
    uvs: Float32Array,
    material: THREE.Material | THREE.Material[],
  ) {
    this.geometry = new THREE.BufferGeometry();

    this.positionAttr = new THREE.BufferAttribute(new Float32Array(initialPositions), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);

    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.geometry.computeVertexNormals();
    this.normalAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    this.normalAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.computeBoundingSphere();

    this.fabric = new THREE.Mesh(this.geometry, material);
    this.materials = Array.isArray(material) ? [...material] : [material];
    this.fabric.frustumCulled = false;
    this.fabric.castShadow = true;
    this.fabric.receiveShadow = true;
    this.fabric.name = 'cloth';

    this.overlay = new FitOverlay(this.geometry);
    this.overlay.setSlotCount(this.materials.length);
    this.slot.add(this.fabric);
    this.slot.add(this.overlay.mesh);
    // The fabric is the pattern surface: diagnostics restyle it, and never the heatmap overlay.
    this.slot.markSurface(this.fabric, true);
    // The heatmap is a display-space colour overlay: the tracer has no use for it.
    this.slot.setTraceMask(this.overlay.mesh, 0);
  }

  /** Copies simulation positions and normals into the draw buffers. */
  updateFromSim(positions: Float32Array, normals: Float32Array): void {
    (this.positionAttr.array as Float32Array).set(positions);
    this.positionAttr.needsUpdate = true;
    (this.normalAttr.array as Float32Array).set(normals);
    this.normalAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  /** Restores the given initial positions and the normals they imply. */
  resetTo(initialPositions: Float32Array): void {
    (this.positionAttr.array as Float32Array).set(initialPositions);
    this.positionAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.normalAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    this.normalAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  /** Replaces every group slot's material, disposing the ones that are no longer used. */
  setMaterials(materials: THREE.Material[]): void {
    for (const old of this.materials) {
      if (!materials.includes(old)) old.dispose();
    }
    this.materials = [...materials];
    this.fabric.material = this.materials;
    // The heatmap repeats its material so hidden panel groups stay hidden in both layers.
    this.overlay.setSlotCount(materials.length);
    this.slot.markChanged('material');
  }

  /** Materials currently bound to the fabric layer. */
  get boundMaterials(): readonly THREE.Material[] {
    return this.materials;
  }

  /** Index ranges of the merged mesh, one per material group slot. */
  addGroups(ranges: SurfaceGroup[]): void {
    const groups = ranges.map(g => ({ start: g.start, count: g.count, materialIndex: g.slot }));
    const changed = groups.length !== this.geometry.groups.length
      || groups.some((group, i) => {
        const previous = this.geometry.groups[i];
        return !previous || previous.start !== group.start
          || previous.count !== group.count || previous.materialIndex !== group.materialIndex;
      });
    this.geometry.groups = groups;
    if (changed) this.slot.markChanged('groups');
  }

  /** Removes both layers from the slot and frees the geometry and their materials. */
  dispose(): void {
    this.slot.markSurface(this.fabric, false);
    this.slot.remove(this.fabric);
    this.slot.remove(this.overlay.mesh);
    this.overlay.dispose();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.materials = [];
  }
}

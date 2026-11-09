/** Turns world mesh data into GPU geometries, reusing one geometry per mesh id. */

import * as THREE from 'three/webgpu';
import type { MeshData, MeshId } from '@/render/common';

interface Entry {
  readonly geometry: THREE.BufferGeometry;
  revision: number;
}

/** Owns the three geometry of every world mesh. */
export class GeometryCache {
  private readonly entries = new Map<MeshId, Entry>();

  /** Geometry of a mesh record, synced to its latest revision. */
  get(mesh: MeshData & { readonly id: MeshId; readonly revision: number }): THREE.BufferGeometry {
    const existing = this.entries.get(mesh.id);
    if (!existing) {
      const geometry = buildGeometry(mesh);
      this.entries.set(mesh.id, { geometry, revision: mesh.revision });
      return geometry;
    }
    if (existing.revision !== mesh.revision) {
      updateGeometry(existing.geometry, mesh);
      existing.revision = mesh.revision;
    }
    return existing.geometry;
  }

  /** Frees every geometry. */
  dispose(): void {
    for (const entry of this.entries.values()) entry.geometry.dispose();
    this.entries.clear();
  }
}

function buildGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  updateGeometry(geometry, mesh);
  return geometry;
}

/**
 * Copies the mesh streams into the geometry buffers. Same-length streams are copied in place, so a
 * cloth frame reuses its GPU buffers instead of allocating one per update.
 */
function updateGeometry(geometry: THREE.BufferGeometry, mesh: MeshData): void {
  copyStream(geometry, 'position', mesh.streams.position, 3);
  copyStream(geometry, 'normal', mesh.streams.normal, 3);
  copyStream(geometry, 'uv', mesh.streams.uv, 2);
  copyStream(geometry, 'color', mesh.streams.color, 3);
  copyStream(geometry, 'field', mesh.streams.field, 1);
  copyIndex(geometry, mesh.index);
  geometry.clearGroups();
  for (const group of mesh.groups ?? []) {
    geometry.addGroup(group.start, group.count, group.materialSlot);
  }
  if (mesh.streams.position.length >= 3) geometry.computeBoundingSphere();
}

function copyStream(
  geometry: THREE.BufferGeometry,
  name: string,
  data: Float32Array | undefined,
  itemSize: number,
): void {
  const existing = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (!data) {
    if (existing) geometry.deleteAttribute(name);
    return;
  }
  if (existing && existing.itemSize === itemSize && existing.array.length === data.length) {
    (existing.array as Float32Array).set(data);
    existing.needsUpdate = true;
    return;
  }
  const attribute = new THREE.BufferAttribute(new Float32Array(data), itemSize);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
}

function copyIndex(geometry: THREE.BufferGeometry, index: Uint32Array | undefined): void {
  if (!index) {
    geometry.setIndex(null);
    return;
  }
  const existing = geometry.getIndex();
  if (existing && existing.array.length === index.length) {
    (existing.array as Uint32Array).set(index);
    existing.needsUpdate = true;
    return;
  }
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
}

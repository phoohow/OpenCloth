import type { EntityId, MaterialId, MeshId, WorldWriter } from '@/render/world';
import type { PresenterHost } from '@/runtime/world/presenters/host';

import { CHANNEL_RASTER } from '@/render/world';

const SELECTION_COLOR = '#ffd400';

const SELECTION_OPACITY = 0.45;

export interface SelectionSurface {
  positions: Float32Array;
  normals: Float32Array;
  uv: Float32Array;
}

export class SelectionOverlay {
  private writer: WorldWriter | null = null;
  private materialId: MaterialId | null = null;
  private meshId: MeshId | null = null;
  private entityId: EntityId | null = null;
  private surface: SelectionSurface | null = null;
  private ids: string[] = [];
  private triangles: Uint32Array | null = null;

  getSelected(): string[] {
    return this.ids;
  }

  apply(
    host: PresenterHost,
    surface: SelectionSurface | null,
    panelIds: string[],
    triangles: Uint32Array,
  ): void {
    if (!surface || panelIds.length === 0) {
      this.clear(host);
      return;
    }

    const sameSurface = this.surface !== null
      && this.surface.positions === surface.positions
      && this.surface.normals === surface.normals
      && this.surface.uv === surface.uv;
    const sameSelection = this.triangles === triangles && sameList(this.ids, panelIds);
    if (this.meshId !== null && sameSurface && sameSelection) return;

    this.clear(host);
    const writer = host.writer;
    this.writer = writer;
    this.meshId = writer.createMesh({
      topology: 'triangle',
      streams: { position: surface.positions, normal: surface.normals, uv: surface.uv },
      index: triangles,
    });
    this.entityId = writer.createEntity({
      layer: 'gizmo',
      tags: ['clothSelection'],
      mesh: { kind: 'mesh', id: this.meshId },
      materials: [{ kind: 'material', id: this.material(host) }],
      channels: CHANNEL_RASTER,
    });
    this.surface = surface;
    this.ids = [...panelIds];
    this.triangles = triangles;
  }

  updateSurface(positions: Float32Array, normals: Float32Array): void {
    const writer = this.writer;
    if (writer === null || this.meshId === null) return;
    writer.updateMesh(this.meshId, { streams: { position: positions, normal: normals } });
  }

  clear(host: PresenterHost): void {
    const writer = host.writer;
    if (this.entityId !== null) writer.destroyEntity(this.entityId);
    if (this.meshId !== null) writer.destroyMesh(this.meshId);
    this.entityId = null;
    this.meshId = null;
    this.surface = null;
    this.ids = [];
    this.triangles = null;
  }

  dispose(host: PresenterHost): void {
    this.clear(host);
    if (this.materialId !== null) host.writer.destroyMaterial(this.materialId);
    this.materialId = null;
    this.writer = null;
  }

  private material(host: PresenterHost): MaterialId {
    if (this.materialId === null) {
      this.materialId = host.writer.createMaterial({
        kind: 'unlit',
        name: 'clothSelection',
        color: SELECTION_COLOR,
        opacity: SELECTION_OPACITY,
        blending: 'alpha',
        depthWrite: false,
        side: 'double',
      });
    }

    return this.materialId;
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

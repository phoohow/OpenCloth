/** Translucent overlay marking the selected cloth panels. */

import { CHANNEL_RASTER } from '@/render/world';
import type { EntityId, MaterialId, MeshId, WorldWriter } from '@/render/world';
import type { PresenterHost } from '@/runtime/presenters/host';

/** Highlight colour and opacity of the selected panels. */
const SELECTION_COLOR = '#ffd400';
const SELECTION_OPACITY = 0.45;

/** Surface arrays the highlight shares with the cloth mesh. */
export interface SelectionSurface {
  positions: Float32Array;
  normals: Float32Array;
  uv: Float32Array;
}

/** Translucent triangle overlay marking the selected panels; shares the cloth mesh streams. */
export class SelectionOverlay {
  private writer: WorldWriter | null = null;
  private materialId: MaterialId | null = null;
  private meshId: MeshId | null = null;
  private entityId: EntityId | null = null;
  private surface: SelectionSurface | null = null;
  private ids: string[] = [];
  private triangles: Uint32Array | null = null;

  /** Selected panel ids, in selection order. */
  getSelected(): string[] {
    return this.ids;
  }

  /** Rebuilds the overlay for these panels; an empty list clears it. Identical inputs are ignored. */
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
    // Array identity catches a rebuilt cloth mesh, which reuses the same panel list.
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

  /** Pushes new simulated surface arrays into the shared streams. */
  updateSurface(positions: Float32Array, normals: Float32Array): void {
    const writer = this.writer;
    if (writer === null || this.meshId === null) return;
    writer.updateMesh(this.meshId, { streams: { position: positions, normal: normals } });
  }

  /** Drops the overlay entity and forgets the selection. */
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

  /** Frees the overlay mesh and material. */
  dispose(host: PresenterHost): void {
    this.clear(host);
    if (this.materialId !== null) host.writer.destroyMaterial(this.materialId);
    this.materialId = null;
    this.writer = null;
  }

  /** Overlay material, written on first use and reused by every selection. */
  private material(host: PresenterHost): MaterialId {
    if (this.materialId === null) {
      // Alpha blending is what makes the compiler treat the overlay as translucent.
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

/** Whether two id lists hold the same ids in the same order. */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

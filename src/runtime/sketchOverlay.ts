/** Temporary polyline that follows a 3D sketch stroke while the pointer draws it. */

import type { Vec3 } from '@/base/math';
import { CHANNEL_RASTER } from '@/render/world';
import type { EntityId, MaterialId, MeshId, WorldWriter } from '@/render/world';
import type { PresenterHost } from '@/runtime/presenters/host';

/** Most samples one stroke draws; extra samples past this are ignored. */
const MAX_STROKE_POINTS = 2048;
/** Stroke colour. */
const STROKE_COLOR = '#ffd166';

/** Temporary polyline that follows a 3D sketch stroke while the pointer draws it. */
export class SketchOverlay {
  private writer: WorldWriter | null = null;
  private meshId: MeshId | null = null;
  private materialId: MaterialId | null = null;
  private entityId: EntityId | null = null;
  private positions = new Float32Array(0);
  private count = 0;

  /** Starts a fresh stroke at a world point. */
  begin(host: PresenterHost, point: Vec3): void {
    this.detach(host);
    const writer = host.writer;
    this.writer = writer;
    this.positions = new Float32Array(MAX_STROKE_POINTS * 3);
    this.meshId = writer.createMesh({
      topology: 'line',
      streams: { position: this.positions },
      index: strokeIndex(),
    });
    this.materialId = writer.createMaterial({
      kind: 'line',
      name: 'sketchStroke',
      color: STROKE_COLOR,
      depth: 'always',
      depthWrite: false,
    });
    this.entityId = writer.createEntity({
      layer: 'gizmo',
      tags: ['sketchStroke'],
      mesh: { kind: 'mesh', id: this.meshId },
      materials: [{ kind: 'material', id: this.materialId }],
      channels: CHANNEL_RASTER,
    });
    this.count = 0;
    this.extend(point);
  }

  /** Appends one world point to the stroke. */
  extend(point: Vec3): void {
    const writer = this.writer;
    if (writer === null || this.meshId === null || this.count >= MAX_STROKE_POINTS) return;
    this.writePoint(this.count, point);
    this.count += 1;
    // Collapse the unused tail onto the newest point so the fixed index pairs draw nothing.
    for (let i = this.count; i < MAX_STROKE_POINTS; i++) this.writePoint(i, point);
    writer.updateMesh(this.meshId, { streams: { position: this.positions } });
  }

  /** Removes the stroke from the world and frees its buffers. */
  detach(host: PresenterHost): void {
    const writer = host.writer;
    if (this.entityId !== null) writer.destroyEntity(this.entityId);
    if (this.meshId !== null) writer.destroyMesh(this.meshId);
    if (this.materialId !== null) writer.destroyMaterial(this.materialId);
    this.entityId = null;
    this.meshId = null;
    this.materialId = null;
    this.writer = null;
    this.positions = new Float32Array(0);
    this.count = 0;
  }

  private writePoint(index: number, point: Vec3): void {
    this.positions[index * 3] = point.x;
    this.positions[index * 3 + 1] = point.y;
    this.positions[index * 3 + 2] = point.z;
  }
}

/** Segment index of the fixed stroke buffer: consecutive point pairs. */
function strokeIndex(): Uint32Array {
  const index = new Uint32Array((MAX_STROKE_POINTS - 1) * 2);
  for (let i = 0; i < MAX_STROKE_POINTS - 1; i++) {
    index[i * 2] = i;
    index[i * 2 + 1] = i + 1;
  }
  return index;
}

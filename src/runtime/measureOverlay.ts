/** Temporary two-point measurement: a segment with one marker per placed point. */

import type { Vec3 } from '@/base/geom';
import { CHANNEL_RASTER } from '@/render/world';
import type { EntityId, MaterialId, MeshId, Transform, WorldWriter } from '@/render/world';
import { markerSphere } from '@/runtime/pinMarkers';
import { overlayMaterial, type PresenterHost } from '@/runtime/presenters/host';

/** Radius of the marker spheres placed on measured points, in meters. */
const MARKER_RADIUS = 0.006;
/** Measurement colour. */
const MEASURE_COLOR = '#ffd166';

/** Temporary two-point measurement: a segment with one marker per placed surface point. */
export class MeasureOverlay {
  private writer: WorldWriter | null = null;
  private lineMeshId: MeshId | null = null;
  private lineMaterialId: MaterialId | null = null;
  private lineEntity: EntityId | null = null;
  private markerMeshId: MeshId | null = null;
  private markerMaterialId: MaterialId | null = null;
  private markerEntities: EntityId[] = [];
  private readonly linePoints = new Float32Array(6);

  /** Draws the placed points; the segment only shows once there are two. */
  setPoints(host: PresenterHost, points: Vec3[]): void {
    if (points.length === 0) {
      this.clear(host);
      return;
    }
    this.ensure(host);
    const writer = this.writer!;
    const first = points[0];
    const second = points[1] ?? first;
    this.linePoints.set([first.x, first.y, first.z, second.x, second.y, second.z]);
    writer.updateMesh(this.lineMeshId!, { streams: { position: this.linePoints } });

    while (this.markerEntities.length > points.length) {
      writer.destroyEntity(this.markerEntities.pop()!);
    }
    for (let i = 0; i < points.length; i++) {
      const transform = pointTransform(points[i]);
      if (i < this.markerEntities.length) {
        writer.updateEntity(this.markerEntities[i], { transform });
      } else {
        this.markerEntities.push(writer.createEntity({
          layer: 'gizmo',
          tags: ['measureMarker'],
          mesh: { kind: 'mesh', id: this.markerMeshId! },
          materials: [{ kind: 'material', id: this.markerMaterialId! }],
          channels: CHANNEL_RASTER,
          transform,
        }));
      }
    }
  }

  /** Removes the measurement from the world and frees its buffers. */
  clear(host: PresenterHost): void {
    const writer = host.writer;
    if (this.lineEntity !== null) writer.destroyEntity(this.lineEntity);
    if (this.lineMeshId !== null) writer.destroyMesh(this.lineMeshId);
    if (this.lineMaterialId !== null) writer.destroyMaterial(this.lineMaterialId);
    for (const entity of this.markerEntities) writer.destroyEntity(entity);
    if (this.markerMeshId !== null) writer.destroyMesh(this.markerMeshId);
    if (this.markerMaterialId !== null) writer.destroyMaterial(this.markerMaterialId);
    this.lineEntity = null;
    this.lineMeshId = null;
    this.lineMaterialId = null;
    this.markerEntities = [];
    this.markerMeshId = null;
    this.markerMaterialId = null;
    this.writer = null;
  }

  /** Writes the segment and the shared marker mesh on first use. */
  private ensure(host: PresenterHost): void {
    if (this.lineEntity !== null) return;
    const writer = host.writer;
    this.writer = writer;
    this.lineMaterialId = writer.createMaterial({
      kind: 'line',
      name: 'measureSegment',
      color: MEASURE_COLOR,
      depth: 'always',
      depthWrite: false,
    });
    this.lineMeshId = writer.createMesh({
      topology: 'line',
      streams: { position: this.linePoints },
      index: new Uint32Array([0, 1]),
    });
    this.lineEntity = writer.createEntity({
      layer: 'gizmo',
      tags: ['measureSegment'],
      mesh: { kind: 'mesh', id: this.lineMeshId },
      materials: [{ kind: 'material', id: this.lineMaterialId }],
      channels: CHANNEL_RASTER,
    });
    this.markerMaterialId = overlayMaterial(writer, MEASURE_COLOR, {
      name: 'measureMarker', depthTest: false,
    });
    this.markerMeshId = writer.createMesh(markerSphere(MARKER_RADIUS));
  }
}

/** Entity transform of one marker, at a measured point. */
function pointTransform(point: Vec3): Transform {
  return {
    position: { x: point.x, y: point.y, z: point.z },
    rotationEuler: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

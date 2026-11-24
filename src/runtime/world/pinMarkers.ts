import type { Vec3 } from '@/base/math';
import type { EntityId, MaterialId, MeshData, MeshId, WorldWriter } from '@/render/world';

import { CHANNEL_RASTER } from '@/render/world';
import { pushTriangle } from '@/runtime/engine/meshPrimitives';
import { overlayMaterial, type PresenterHost } from '@/runtime/world/presenters/host';

const MARKER_RADIUS_M = 0.007;

const PIN_COLOR = '#ffd24a';

const PIN_HIGHLIGHT_COLOR = '#ff5a5a';

const HIGHLIGHT_SCALE = 1.7;

interface PinMarkerEntry {
  readonly entity: EntityId;
  position: Vec3;
}

export class PinMarkers {
  private writer: WorldWriter | null = null;
  private meshId: MeshId | null = null;
  private materialId: MaterialId | null = null;
  private highlightMaterialId: MaterialId | null = null;
  private readonly markers = new Map<number, PinMarkerEntry>();
  private highlighted: number | null = null;

  add(particleIndex: number, positions: Float32Array | null, host: PresenterHost): void {
    if (this.markers.has(particleIndex)) return;
    const writer = this.ensureShared(host);
    const position = particlePosition(positions, particleIndex);
    const entity = writer.createEntity({
      layer: 'gizmo',
      tags: ['pinMarker'],
      mesh: { kind: 'mesh', id: this.meshId! },
      materials: [{ kind: 'material', id: this.materialId! }],
      channels: CHANNEL_RASTER,
      transform: markerTransform(position, 1),
    });
    host.bind('pin', entity, () => String(particleIndex));
    this.markers.set(particleIndex, { entity, position });
  }

  remove(particleIndex: number, host: PresenterHost): void {
    const marker = this.markers.get(particleIndex);
    if (!marker) return;
    host.unbind(marker.entity);
    host.writer.destroyEntity(marker.entity);
    this.markers.delete(particleIndex);
    if (this.highlighted === particleIndex) this.highlighted = null;
  }

  highlight(particleIndex: number | null): void {
    if (this.highlighted === particleIndex) return;
    const writer = this.writer;
    const previous = this.highlighted === null ? null : this.markers.get(this.highlighted);
    if (previous && writer) this.paint(writer, previous, false);
    this.highlighted = null;
    const marker = particleIndex === null ? null : this.markers.get(particleIndex);
    if (marker && writer) {
      this.paint(writer, marker, true);
      this.highlighted = particleIndex;
    }
  }

  highlightedIndex(): number | null {
    return this.highlighted;
  }

  sync(positions: Float32Array): void {
    const writer = this.writer;
    if (writer === null) return;
    for (const [particleIndex, marker] of this.markers) {
      marker.position = particlePosition(positions, particleIndex);
      const scale = this.highlighted === particleIndex ? HIGHLIGHT_SCALE : 1;
      writer.updateEntity(marker.entity, { transform: markerTransform(marker.position, scale) });
    }
  }

  clear(host: PresenterHost): void {
    for (const [, marker] of this.markers) {
      host.unbind(marker.entity);
      host.writer.destroyEntity(marker.entity);
    }

    this.markers.clear();
    this.highlighted = null;
  }

  list(): number[] {
    return Array.from(this.markers.keys());
  }

  dispose(host: PresenterHost): void {
    this.clear(host);
    const writer = host.writer;
    if (this.meshId !== null) writer.destroyMesh(this.meshId);
    if (this.materialId !== null) writer.destroyMaterial(this.materialId);
    if (this.highlightMaterialId !== null) writer.destroyMaterial(this.highlightMaterialId);
    this.meshId = null;
    this.materialId = null;
    this.highlightMaterialId = null;
    this.writer = null;
  }

  private ensureShared(host: PresenterHost): WorldWriter {
    const writer = host.writer;
    if (this.writer === null) {
      this.writer = writer;
      this.meshId = writer.createMesh(markerSphere(MARKER_RADIUS_M));
      this.materialId = overlayMaterial(writer, PIN_COLOR, { name: 'pinMarker' });
      this.highlightMaterialId = overlayMaterial(writer, PIN_HIGHLIGHT_COLOR, {
        name: 'pinMarkerHighlight',
      });
    }

    return writer;
  }

  private paint(writer: WorldWriter, marker: PinMarkerEntry, highlighted: boolean): void {
    writer.updateEntity(marker.entity, {
      materials: [{
        kind: 'material',
        id: highlighted ? this.highlightMaterialId! : this.materialId!,
      }],
      transform: markerTransform(marker.position, highlighted ? HIGHLIGHT_SCALE : 1),
    });
  }
}

export function markerSphere(radius: number, segments = 12, rings = 8): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const point = (phi: number, theta: number): readonly [number, number, number] => {
    const sinPhi = Math.sin(phi);
    return [
      radius * sinPhi * Math.cos(theta),
      radius * Math.cos(phi),
      radius * sinPhi * Math.sin(theta),
    ];
  };
  const normal = (phi: number, theta: number): readonly [number, number, number] => {
    const sinPhi = Math.sin(phi);
    return [sinPhi * Math.cos(theta), Math.cos(phi), sinPhi * Math.sin(theta)];
  };
  for (let ring = 0; ring < rings; ring++) {
    const phi0 = (ring / rings) * Math.PI;
    const phi1 = ((ring + 1) / rings) * Math.PI;
    for (let seg = 0; seg < segments; seg++) {
      const theta0 = (seg / segments) * Math.PI * 2;
      const theta1 = ((seg + 1) / segments) * Math.PI * 2;
      pushTriangle(
        positions, normals,
        point(phi0, theta0), point(phi0, theta1), point(phi1, theta1),
        normal(phi0, theta0), normal(phi0, theta1), normal(phi1, theta1),
      );
      pushTriangle(
        positions, normals,
        point(phi0, theta0), point(phi1, theta1), point(phi1, theta0),
        normal(phi0, theta0), normal(phi1, theta1), normal(phi1, theta0),
      );
    }
  }

  return {
    topology: 'triangle',
    streams: { position: new Float32Array(positions), normal: new Float32Array(normals) },
  };
}

function particlePosition(positions: Float32Array | null, particleIndex: number): Vec3 {
  if (!positions || particleIndex * 3 + 2 >= positions.length) return { x: 0, y: 0, z: 0 };
  return {
    x: positions[particleIndex * 3],
    y: positions[particleIndex * 3 + 1],
    z: positions[particleIndex * 3 + 2],
  };
}

function markerTransform(position: Vec3, scale: number): {
  position: Vec3; rotationEuler: Vec3; scale: Vec3;
} {
  return {
    position: { ...position },
    rotationEuler: { x: 0, y: 0, z: 0 },
    scale: { x: scale, y: scale, z: scale },
  };
}

/** Small spheres marking pinned cloth particles. */

import type { Vec3 } from '@/base/math';
import { CHANNEL_RASTER } from '@/render/world';
import type { EntityId, MaterialId, MeshData, MeshId, WorldWriter } from '@/render/world';
import { overlayMaterial, type PresenterHost } from '@/runtime/presenters/host';

/** 7 mm radius: about half a fingertip, so a row of pins still reads as separate dots. */
const MARKER_RADIUS_M = 0.007;
/** Marker colour, and the red one used to show which pin a click would remove. */
const PIN_COLOR = '#ffd24a';
const PIN_HIGHLIGHT_COLOR = '#ff5a5a';
/** Scale a highlighted marker keeps so it reads at a glance. */
const HIGHLIGHT_SCALE = 1.7;

/** One placed marker: its entity and the position it follows. */
interface PinMarkerEntry {
  readonly entity: EntityId;
  position: Vec3;
}

/** Small spheres marking pinned cloth particles. */
export class PinMarkers {
  private writer: WorldWriter | null = null;
  private meshId: MeshId | null = null;
  private materialId: MaterialId | null = null;
  private highlightMaterialId: MaterialId | null = null;
  private readonly markers = new Map<number, PinMarkerEntry>();
  private highlighted: number | null = null;

  /** Places a marker on a particle; a null buffer leaves it at the origin. */
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

  /** Drops the marker of one particle. */
  remove(particleIndex: number, host: PresenterHost): void {
    const marker = this.markers.get(particleIndex);
    if (!marker) return;
    host.unbind(marker.entity);
    host.writer.destroyEntity(marker.entity);
    this.markers.delete(particleIndex);
    if (this.highlighted === particleIndex) this.highlighted = null;
  }

  /**
   * Marks one pin as the target of the next click: it turns red and grows, so the pointer cursor
   * and the cloth agree on what would be removed. Null restores the plain marker.
   */
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

  /** Particle index currently highlighted, or null. */
  highlightedIndex(): number | null {
    return this.highlighted;
  }

  /** Keeps markers on their particles after a simulation readback. */
  sync(positions: Float32Array): void {
    const writer = this.writer;
    if (writer === null) return;
    for (const [particleIndex, marker] of this.markers) {
      marker.position = particlePosition(positions, particleIndex);
      const scale = this.highlighted === particleIndex ? HIGHLIGHT_SCALE : 1;
      writer.updateEntity(marker.entity, { transform: markerTransform(marker.position, scale) });
    }
  }

  /** Removes every marker from the world. */
  clear(host: PresenterHost): void {
    for (const [, marker] of this.markers) {
      host.unbind(marker.entity);
      host.writer.destroyEntity(marker.entity);
    }
    this.markers.clear();
    this.highlighted = null;
  }

  /** Particle indices that currently have a marker. */
  list(): number[] {
    return Array.from(this.markers.keys());
  }

  /** Clears the markers and frees the mesh and materials they share. */
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

  /** Creates the shared mesh and materials on first use. */
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

/** Sphere triangle mesh shared by the pin, measurement and drag markers. */
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
      // Two triangles per quad of the latitude/longitude grid.
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

function pushTriangle(
  positions: number[], normals: number[],
  a: readonly [number, number, number], b: readonly [number, number, number],
  c: readonly [number, number, number],
  na: readonly [number, number, number], nb: readonly [number, number, number],
  nc: readonly [number, number, number],
): void {
  positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  normals.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
}

/** Particle position, or the origin while the buffer is missing or too short. */
function particlePosition(positions: Float32Array | null, particleIndex: number): Vec3 {
  if (!positions || particleIndex * 3 + 2 >= positions.length) return { x: 0, y: 0, z: 0 };
  return {
    x: positions[particleIndex * 3],
    y: positions[particleIndex * 3 + 1],
    z: positions[particleIndex * 3 + 2],
  };
}

/** Entity transform of a marker: offset by the position, scaled about its centre. */
function markerTransform(position: Vec3, scale: number): {
  position: Vec3; rotationEuler: Vec3; scale: Vec3;
} {
  return {
    position: { ...position },
    rotationEuler: { x: 0, y: 0, z: 0 },
    scale: { x: scale, y: scale, z: scale },
  };
}

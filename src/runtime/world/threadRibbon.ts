import type { EntityId, MaterialId, MeshId, WorldWriter } from '@/render/world';
import type { PresenterHost } from '@/runtime/world/presenters/host';

import { hexToLinearRgb, type LinearRgb } from '@/base/color';
import { unit3t, type Vec3, type Vec3Tuple } from '@/base/math';
import { CHANNEL_RASTER } from '@/render/world';
import { anchorNormal, anchorPosition, type SurfaceAnchor } from '@/runtime/engine/surfaceAnchor';

const THREAD_OFFSET_M = 0.0005;

export const THREAD_PIXELS = 1.8;

export const THREAD_MIN_WIDTH_M = 0.0006;

export const THREAD_MAX_WIDTH_M = 0.006;

export const THREAD_FALLBACK_WIDTH_M = 0.0025;

export interface ThreadSegment {
  readonly a: SurfaceAnchor;
  readonly b: SurfaceAnchor;
  readonly color: string;
}

export function threadWidthMeters(metersPerPixel: number): number {
  if (!(metersPerPixel > 0)) return THREAD_FALLBACK_WIDTH_M;
  return clampWidth(metersPerPixel * THREAD_PIXELS);
}

function clampWidth(width: number): number {
  return Math.min(THREAD_MAX_WIDTH_M, Math.max(THREAD_MIN_WIDTH_M, width));
}

export class ThreadRibbon {
  private writer: WorldWriter | null = null;
  private meshId: MeshId | null = null;
  private materialId: MaterialId | null = null;
  private entityId: EntityId | null = null;
  private segments: ThreadSegment[] = [];
  private positions = new Float32Array(0);
  private visible = true;

  constructor(private readonly widthScale = 1) {}

  attach(
    host: PresenterHost, segments: ThreadSegment[], positions: Float32Array,
    normals: Float32Array | undefined, width: number, name: string, bindKey: string,
  ): void {
    this.detach(host);
    if (segments.length === 0) return;
    const writer = host.writer;
    this.writer = writer;
    this.segments = segments;
    this.positions = new Float32Array(segments.length * 18);
    this.meshId = writer.createMesh({
      topology: 'triangle',
      streams: { position: this.positions, color: segmentColors(segments) },
    });
    this.materialId = writer.createMaterial({
      kind: 'unlit',
      name,
      vertexColors: true,
      blending: 'alpha',
      depthWrite: false,
      side: 'double',
    });
    this.entityId = writer.createEntity({
      layer: 'overlay',
      tags: [name],
      mesh: { kind: 'mesh', id: this.meshId },
      materials: [{ kind: 'material', id: this.materialId }],
      channels: this.visible ? CHANNEL_RASTER : 0,
    });
    host.bind(bindKey, this.entityId);
    this.update(positions, normals, width);
  }

  update(positions: Float32Array, normals: Float32Array | undefined, width: number): void {
    const writer = this.writer;
    if (writer === null || this.meshId === null) return;
    if (this.positions.length !== this.segments.length * 18) {
      this.positions = new Float32Array(this.segments.length * 18);
    }

    const half = clampWidth(width * this.widthScale) / 2;
    const arr = this.positions;
    const start: Vec3 = { x: 0, y: 0, z: 0 };
    const end: Vec3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < this.segments.length; i++) {
      const { a, b } = this.segments[i];
      const offset = i * 18;
      if (!anchorPosition(a, positions, start) || !anchorPosition(b, positions, end)) {
        arr.fill(0, offset, offset + 18);
        continue;
      }

      const normal = averageNormal(a, b, normals);
      const tx = end.x - start.x;
      const ty = end.y - start.y;
      const tz = end.z - start.z;
      const length = Math.hypot(tx, ty, tz);
      let sx = 0;
      let sy = 0;
      let sz = 0;
      if (length > 1e-9) {
        const rx = (normal[1] * tz - normal[2] * ty) / length;
        const ry = (normal[2] * tx - normal[0] * tz) / length;
        const rz = (normal[0] * ty - normal[1] * tx) / length;
        const side = unit3t([rx, ry, rz], 1e-9) ?? [0, 0, 0];
        sx = side[0] * half;
        sy = side[1] * half;
        sz = side[2] * half;
      }

      const ox = normal[0] * THREAD_OFFSET_M;
      const oy = normal[1] * THREAD_OFFSET_M;
      const oz = normal[2] * THREAD_OFFSET_M;
      const ax = start.x + ox;
      const ay = start.y + oy;
      const az = start.z + oz;
      const bx = end.x + ox;
      const by = end.y + oy;
      const bz = end.z + oz;
      arr[offset] = ax - sx; arr[offset + 1] = ay - sy; arr[offset + 2] = az - sz;
      arr[offset + 3] = ax + sx; arr[offset + 4] = ay + sy; arr[offset + 5] = az + sz;
      arr[offset + 6] = bx + sx; arr[offset + 7] = by + sy; arr[offset + 8] = bz + sz;
      arr[offset + 9] = ax - sx; arr[offset + 10] = ay - sy; arr[offset + 11] = az - sz;
      arr[offset + 12] = bx + sx; arr[offset + 13] = by + sy; arr[offset + 14] = bz + sz;
      arr[offset + 15] = bx - sx; arr[offset + 16] = by - sy; arr[offset + 17] = bz - sz;
    }

    writer.updateMesh(this.meshId, { streams: { position: this.positions } });
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (this.writer === null || this.entityId === null) return;
    this.writer.updateEntity(this.entityId, { channels: visible ? CHANNEL_RASTER : 0 });
  }

  detach(host: PresenterHost): void {
    const writer = host.writer;
    if (this.entityId !== null) {
      host.unbind(this.entityId);
      writer.destroyEntity(this.entityId);
    }

    if (this.meshId !== null) writer.destroyMesh(this.meshId);
    if (this.materialId !== null) writer.destroyMaterial(this.materialId);
    this.entityId = null;
    this.meshId = null;
    this.materialId = null;
    this.writer = null;
    this.segments = [];
    this.positions = new Float32Array(0);
  }
}

function averageNormal(
  a: SurfaceAnchor, b: SurfaceAnchor, normals?: Float32Array,
): Vec3Tuple {
  const na = anchorNormal(a, normals);
  const nb = anchorNormal(b, normals);
  return unit3t([na[0] + nb[0], na[1] + nb[1], na[2] + nb[2]], 1e-9) ?? na;
}

function segmentColors(segments: ThreadSegment[]): Float32Array {
  const colors = new Float32Array(segments.length * 18);
  const cache = new Map<string, LinearRgb>();
  for (let i = 0; i < segments.length; i++) {
    const hex = segments[i].color;
    let color = cache.get(hex);
    if (!color) {
      color = hexToLinearRgb(hex);
      cache.set(hex, color);
    }

    for (let vertex = 0; vertex < 6; vertex++) {
      const offset = i * 18 + vertex * 3;
      colors[offset] = color[0];
      colors[offset + 1] = color[1];
      colors[offset + 2] = color[2];
    }
  }

  return colors;
}

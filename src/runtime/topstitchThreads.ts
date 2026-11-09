/** Topstitch rows drawn as a thin ribbon above the cloth surface. */

import type { Pattern, Project, Topstitch, Vec2 } from '@/model/types';
import type { TriangleMesh } from '@/pattern/triangulate';
import { topstitchRows } from '@/pattern/panel';
import { CHANNEL_RASTER } from '@/render/world';
import type { EntityId, MaterialId, MeshId, WorldWriter } from '@/render/world';
import type { PresenterHost } from '@/runtime/presenters/host';
import type { ClothSimInput } from '@/sim';

/** Width of one thread ribbon, in meters. */
const THREAD_WIDTH_M = 0.0008;
/** Lift above the cloth surface so the thread does not z-fight, in meters. */
const THREAD_OFFSET_M = 0.0004;

/** One drawn topstitch segment between two merged cloth particles. */
export interface TopstitchSegment {
  a: number;
  b: number;
  /** Stitch colour shared by both endpoints. */
  color: string;
}

/** Topstitch records of one panel that the overlay draws. */
function visibleTopstitches(pattern: Pattern, panelId: string): Topstitch[] {
  return Object.values(pattern.topstitches ?? {}).filter(
    stitch => stitch.panelId === panelId && stitch.visible !== false,
  );
}

/**
 * Line segments of every visible topstitch, mapped onto merged particle indices. Each sampled
 * row point snaps to its nearest mesh vertex, so the thread rides the cloth instead of floating.
 */
export function topstitchSegments(project: Project, panels: ClothSimInput['panels']): TopstitchSegment[] {
  const pattern = project.pattern;
  const segments: TopstitchSegment[] = [];
  for (const panel of panels) {
    if (pattern.panels[panel.panelId]?.visible === false) continue;
    for (const stitch of visibleTopstitches(pattern, panel.panelId)) {
      for (const row of topstitchRows(pattern, stitch)) {
        let previous = -1;
        for (const point of row) {
          const local = nearestVertex(panel.mesh, point);
          if (local < 0 || local === previous) continue;
          if (previous >= 0) {
            segments.push({ a: panel.vertexOffset + previous, b: panel.vertexOffset + local, color: stitch.color });
          }
          previous = local;
        }
      }
    }
  }
  return segments;
}

/** Mesh vertex nearest to a pattern point, or -1 for an empty mesh. */
function nearestVertex(mesh: TriangleMesh, point: Vec2): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const dx = mesh.positions[i * 2] - point.x;
    const dy = mesh.positions[i * 2 + 1] - point.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Ribbon mesh of every stitch segment, drawn above the cloth. */
export class TopstitchThreads {
  private writer: WorldWriter | null = null;
  private meshId: MeshId | null = null;
  private materialId: MaterialId | null = null;
  private entityId: EntityId | null = null;
  private segments: TopstitchSegment[] = [];
  private positions = new Float32Array(0);
  private colors: Float32Array = new Float32Array(0);
  private visible = true;

  /** Builds one ribbon quad per stitch step and writes the thread entity. */
  attach(
    host: PresenterHost, segments: TopstitchSegment[], positions: Float32Array, normals?: Float32Array,
  ): void {
    this.detach(host);
    if (segments.length === 0) return;
    const writer = host.writer;
    this.writer = writer;
    this.segments = segments;
    this.positions = new Float32Array(segments.length * 18);
    this.colors = segmentColors(segments);
    this.meshId = writer.createMesh({
      topology: 'triangle',
      streams: { position: this.positions, color: this.colors },
    });
    this.materialId = writer.createMaterial({
      kind: 'unlit',
      name: 'topstitchThreads',
      vertexColors: true,
      blending: 'alpha',
      depthWrite: false,
      side: 'double',
    });
    this.entityId = writer.createEntity({
      layer: 'overlay',
      tags: ['topstitchThreads'],
      mesh: { kind: 'mesh', id: this.meshId },
      materials: [{ kind: 'material', id: this.materialId }],
      channels: this.visible ? CHANNEL_RASTER : 0,
    });
    host.bind('topstitch', this.entityId);
    this.update(positions, normals);
  }

  /** Moves every ribbon quad onto the current particle positions and normals. */
  update(positions: Float32Array, normals?: Float32Array): void {
    const writer = this.writer;
    if (writer === null || this.meshId === null) return;
    if (this.positions.length !== this.segments.length * 18) {
      this.positions = new Float32Array(this.segments.length * 18);
    }
    const arr = this.positions;
    for (let i = 0; i < this.segments.length; i++) {
      const { a, b } = this.segments[i];
      const offset = i * 18;
      const a3 = a * 3;
      const b3 = b * 3;
      if (a3 + 2 >= positions.length || b3 + 2 >= positions.length) {
        arr.fill(0, offset, offset + 18);
        continue;
      }
      const ax = positions[a3];
      const ay = positions[a3 + 1];
      const az = positions[a3 + 2];
      const bx = positions[b3];
      const by = positions[b3 + 1];
      const bz = positions[b3 + 2];
      const [nx, ny, nz] = normalAt(a, b, normals);
      const tx = bx - ax;
      const ty = by - ay;
      const tz = bz - az;
      const tLen = Math.hypot(tx, ty, tz);
      let sx = 0;
      let sy = 0;
      let sz = 0;
      if (tLen > 1e-9) {
        // Side = normal × tangent, scaled to half the thread width.
        const rx = (ny * tz - nz * ty) / tLen;
        const ry = (nz * tx - nx * tz) / tLen;
        const rz = (nx * ty - ny * tx) / tLen;
        const rLen = Math.hypot(rx, ry, rz) || 1;
        const half = THREAD_WIDTH_M / 2 / rLen;
        sx = rx * half;
        sy = ry * half;
        sz = rz * half;
      }
      const ox = nx * THREAD_OFFSET_M;
      const oy = ny * THREAD_OFFSET_M;
      const oz = nz * THREAD_OFFSET_M;
      const axo = ax + ox;
      const ayo = ay + oy;
      const azo = az + oz;
      const bxo = bx + ox;
      const byo = by + oy;
      const bzo = bz + oz;
      // Two triangles: a-side / a+side / b+side and a-side / b+side / b-side.
      arr[offset] = axo - sx; arr[offset + 1] = ayo - sy; arr[offset + 2] = azo - sz;
      arr[offset + 3] = axo + sx; arr[offset + 4] = ayo + sy; arr[offset + 5] = azo + sz;
      arr[offset + 6] = bxo + sx; arr[offset + 7] = byo + sy; arr[offset + 8] = bzo + sz;
      arr[offset + 9] = axo - sx; arr[offset + 10] = ayo - sy; arr[offset + 11] = azo - sz;
      arr[offset + 12] = bxo + sx; arr[offset + 13] = byo + sy; arr[offset + 14] = bzo + sz;
      arr[offset + 15] = bxo - sx; arr[offset + 16] = byo - sy; arr[offset + 17] = bzo - sz;
    }
    writer.updateMesh(this.meshId, { streams: { position: this.positions } });
  }

  /** Shows or hides the overlay together with the cloth mesh beneath it. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.writer === null || this.entityId === null) return;
    this.writer.updateEntity(this.entityId, { channels: visible ? CHANNEL_RASTER : 0 });
  }

  /** Removes the ribbon from the world and frees its buffers. */
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
    this.colors = new Float32Array(0);
  }
}

/** Surface normal at a segment: the average of both endpoint normals, or up as a fallback. */
function normalAt(a: number, b: number, normals?: Float32Array): readonly [number, number, number] {
  if (normals && a * 3 + 2 < normals.length && b * 3 + 2 < normals.length) {
    const x = normals[a * 3] + normals[b * 3];
    const y = normals[a * 3 + 1] + normals[b * 3 + 1];
    const z = normals[a * 3 + 2] + normals[b * 3 + 2];
    const len = Math.hypot(x, y, z);
    if (len > 1e-9) return [x / len, y / len, z / len];
  }
  return [0, 1, 0];
}

/** Linear vertex color of every ribbon corner. */
function segmentColors(segments: TopstitchSegment[]): Float32Array {
  const colors = new Float32Array(segments.length * 18);
  const cache = new Map<string, readonly [number, number, number]>();
  for (let i = 0; i < segments.length; i++) {
    const hex = segments[i].color;
    let color = cache.get(hex);
    if (!color) {
      color = hexToLinear(hex);
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

/** Linear rgb of a hex color, matching the color space vertex colors are read in. */
function hexToLinear(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [channel((value >> 16) & 0xff), channel((value >> 8) & 0xff), channel(value & 0xff)];
}

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

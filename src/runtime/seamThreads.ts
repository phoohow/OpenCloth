/** Thread overlay drawn between paired seam edges; it dims as a seam closes. */

import { distance3At as distance } from '@/base/geom';
import { hexToLinearRgb, type LinearRgb } from '@/base/color';
import type { Seam } from '@/model/types';
import { CHANNEL_RASTER } from '@/render/world';
import type { EntityId, MaterialId, MeshId, WorldWriter } from '@/render/world';
import type { PresenterHost } from '@/runtime/presenters/host';
import type { SeamPair } from '@/runtime/seamPair';

/** Linear rgb triplet of a thread color. */
type Rgb = LinearRgb;

/** Thread overlay drawn between paired seam edges; it dims as a seam closes. */
export class SeamThreads {
  private writer: WorldWriter | null = null;
  private meshId: MeshId | null = null;
  private materialId: MaterialId | null = null;
  private entityId: EntityId | null = null;
  private positions = new Float32Array(0);
  private colors = new Float32Array(0);
  private seams: Record<string, Seam> = {};
  /** Linear thread color of each seam. */
  private palette = new Map<string, Rgb>();

  /** Builds one line segment per seam pair and writes the thread entity. */
  attach(
    host: PresenterHost, pairs: SeamPair[], positions: Float32Array, seams: Record<string, Seam>,
  ): void {
    this.detach(host);
    if (pairs.length === 0) return;
    const writer = host.writer;
    this.writer = writer;
    this.positions = new Float32Array(pairs.length * 6);
    this.colors = new Float32Array(pairs.length * 6);
    this.meshId = writer.createMesh({
      topology: 'line',
      streams: { position: this.positions, color: this.colors },
    });
    this.materialId = writer.createMaterial({
      kind: 'line',
      name: 'seamThreads',
      vertexColors: true,
      blending: 'additive',
      depthWrite: false,
      side: 'double',
    });
    this.entityId = writer.createEntity({
      layer: 'overlay',
      tags: ['seamThreads'],
      mesh: { kind: 'mesh', id: this.meshId },
      materials: [{ kind: 'material', id: this.materialId }],
      channels: CHANNEL_RASTER,
    });
    host.bind('seam', this.entityId);
    this.setSeams(seams);
    this.update(pairs, positions);
  }

  /** Sets the seam records whose thread color and visibility the overlay draws. */
  setSeams(seams: Record<string, Seam>): void {
    this.seams = seams;
    this.palette = new Map(
      Object.values(seams).map(seam => [seam.id, hexToLinearRgb(seam.threadColor)]),
    );
  }

  /** Moves the threads to the given positions and dims each one as its seam closes. */
  update(pairs: SeamPair[], positions: Float32Array): void {
    const writer = this.writer;
    if (writer === null || this.meshId === null) return;
    // The pair set changes when a dart closes, so the buffers are resized rather than overrun.
    if (this.positions.length !== pairs.length * 6) {
      this.positions = new Float32Array(pairs.length * 6);
      this.colors = new Float32Array(pairs.length * 6);
    }
    for (let i = 0; i < pairs.length; i++) {
      const { p0, p1, open, seamId } = pairs[i];
      const offset = i * 6;
      this.positions[offset] = positions[p0 * 3];
      this.positions[offset + 1] = positions[p0 * 3 + 1];
      this.positions[offset + 2] = positions[p0 * 3 + 2];
      this.positions[offset + 3] = positions[p1 * 3];
      this.positions[offset + 4] = positions[p1 * 3 + 1];
      this.positions[offset + 5] = positions[p1 * 3 + 2];
      const shown = this.seams[seamId]?.stitchVisible !== false;
      const level = shown ? fadeLevel(distance(positions, p0, p1), open) : 0;
      const color = this.palette.get(seamId) ?? THREAD_FALLBACK;
      for (let vertex = 0; vertex < 2; vertex++) {
        this.colors[offset + vertex * 3] = color[0] * level;
        this.colors[offset + vertex * 3 + 1] = color[1] * level;
        this.colors[offset + vertex * 3 + 2] = color[2] * level;
      }
    }
    writer.updateMesh(this.meshId, { streams: { position: this.positions, color: this.colors } });
  }

  /** Removes the thread entity from the world and frees its buffers. */
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
    this.positions = new Float32Array(0);
    this.colors = new Float32Array(0);
  }
}

/** Thread color used when a pair's seam record is gone. */
const THREAD_FALLBACK: Rgb = hexToLinearRgb('#5cd9ff');

/** Bright while open, fading to black (invisible under additive blending) near closure. */
function fadeLevel(gap: number, open: number): number {
  return Math.min(1, gap / Math.max(open * 0.3, 0.01));
}

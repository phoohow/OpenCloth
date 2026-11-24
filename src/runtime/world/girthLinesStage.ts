import type { AvatarParams, ObjectTransform } from '@/model/types';
import type { EntityId, MeshDesc, MeshId } from '@/render/world';
import type { PresenterHost } from '@/runtime/world/presenters/host';

import { advanceFrame, bodyLandmarks, outlinePoints, tubeFrame, type GirthLine } from '@/avatar';
import { hexToLinearRgb } from '@/base/color';
import { add3t, normalize3t, scale3t, sub3t, type Vec3Tuple } from '@/base/math';
import { CHANNEL_RASTER } from '@/render/world';
import { guideTransform } from '@/runtime/world/guideTransform';

const TUBE_SIDES = 6;

const LINE_THICKNESS = 0.0012;

const LINE_COLOR = '#ff3b30';

interface LineMesh {
  positions: number[];
  colors: number[];
  index: number[];
}

function sweepTube(out: LineMesh, path: readonly Vec3Tuple[], color: readonly number[]): void {
  const count = path.length;
  const base = out.positions.length / 3;
  const tangentAt = (i: number): Vec3Tuple =>
    normalize3t(sub3t(path[(i + 1) % count]!, path[(i - 1 + count) % count]!));

  let frame = tubeFrame(tangentAt(0));
  for (let i = 0; i < count; i++) {
    const tangent = tangentAt(i);
    frame = advanceFrame(frame, tangent);
    for (let j = 0; j < TUBE_SIDES; j++) {
      const around = (j / TUBE_SIDES) * Math.PI * 2;
      const offset = add3t(
        scale3t(frame.u, Math.cos(around) * LINE_THICKNESS),
        scale3t(frame.v, Math.sin(around) * LINE_THICKNESS),
      );
      const p = add3t(path[i]!, offset);
      out.positions.push(p[0], p[1], p[2]);
      out.colors.push(color[0], color[1], color[2]);
    }
  }

  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    for (let j = 0; j < TUBE_SIDES; j++) {
      const side = (j + 1) % TUBE_SIDES;
      const a = base + i * TUBE_SIDES + j;
      const b = base + next * TUBE_SIDES + j;
      const c = base + next * TUBE_SIDES + side;
      const d = base + i * TUBE_SIDES + side;
      out.index.push(a, b, c, a, c, d);
    }
  }
}

function girthLineMesh(lines: readonly GirthLine[]): MeshDesc {
  const out: LineMesh = { positions: [], colors: [], index: [] };
  const color = hexToLinearRgb(LINE_COLOR);
  for (const line of lines) sweepTube(out, outlinePoints(line), color);
  return {
    topology: 'triangle',
    streams: {
      position: new Float32Array(out.positions),
      color: new Float32Array(out.colors),
    },
    index: new Uint32Array(out.index),
  };
}

export class GirthLinesStage {
  private readonly meshId: MeshId;
  private readonly entity: EntityId;
  private visible = false;

  constructor(private readonly host: PresenterHost, params: AvatarParams, transform?: ObjectTransform) {
    const lines = bodyLandmarks(params).bodyGirthLines();
    const writer = host.writer;
    this.meshId = writer.createMesh(girthLineMesh(lines));
    this.entity = writer.createEntity({
      layer: 'gizmo',
      tags: ['girthLines'],
      mesh: { kind: 'mesh', id: this.meshId },
      channels: CHANNEL_RASTER,
      transform: guideTransform(transform),
    });
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.host.writer.updateEntity(this.entity, {
      tags: visible ? ['girthLines', 'wireGuide'] : ['girthLines'],
    });
  }

  place(transform?: ObjectTransform): void {
    this.host.writer.updateEntity(this.entity, { transform: guideTransform(transform) });
  }

  dispose(): void {
    const writer = this.host.writer;
    writer.destroyEntity(this.entity);
    writer.destroyMesh(this.meshId);
  }
}

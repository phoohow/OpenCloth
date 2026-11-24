import type { AvatarParams, ObjectTransform } from '@/model/types';
import type { EntityId, MeshDesc, MeshId } from '@/render/world';
import type { PresenterHost } from '@/runtime/world/presenters/host';

import { advanceFrame, bodyLandmarks, tubeFrame, type SimplifiedShape } from '@/avatar';
import { hexToLinearRgb } from '@/base/color';
import { normalize3t, sub3t } from '@/base/math';
import { CHANNEL_RASTER } from '@/render/world';
import { guideTransform } from '@/runtime/world/guideTransform';

const GRID_STEP = 0.04;

const PROXY_COLOR = '#73b894';

interface WireMesh {
  positions: number[];
  colors: number[];
  index: number[];
}

function stepsOf(span: number, min: number): number {
  return Math.max(min, Math.round(span / GRID_STEP));
}

function aroundSteps(perimeter: number): number {
  return stepsOf(perimeter, 6);
}

function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

function pushVertex(out: WireMesh, p: readonly [number, number, number]): number {
  const index = out.positions.length / 3;
  out.positions.push(p[0], p[1], p[2]);
  const color = hexToLinearRgb(PROXY_COLOR);
  out.colors.push(color[0], color[1], color[2]);
  return index;
}

function link(out: WireMesh, a: number, b: number): void {
  out.index.push(a, b);
}

function addTube(out: WireMesh, shape: Extract<SimplifiedShape, { kind: 'tube' }>): void {
  const axis = normalize3t([
    shape.to[0] - shape.from[0],
    shape.to[1] - shape.from[1],
    shape.to[2] - shape.from[2],
  ]);
  const { u, v } = tubeFrame(axis);
  const segments = aroundSteps(Math.PI * (shape.fromR + shape.toR));
  const levels = stepsOf(Math.hypot(
    shape.to[0] - shape.from[0], shape.to[1] - shape.from[1], shape.to[2] - shape.from[2],
  ), 2);
  const rings: number[][] = [];
  for (let level = 0; level <= levels; level++) {
    const t = level / levels;
    const centre: [number, number, number] = [
      shape.from[0] + (shape.to[0] - shape.from[0]) * t,
      shape.from[1] + (shape.to[1] - shape.from[1]) * t,
      shape.from[2] + (shape.to[2] - shape.from[2]) * t,
    ];
    const radius = shape.fromR + (shape.toR - shape.fromR) * t;
    const ring: number[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      ring.push(pushVertex(out, [
        centre[0] + (u[0] * c + v[0] * s) * radius,
        centre[1] + (u[1] * c + v[1] * s) * radius,
        centre[2] + (u[2] * c + v[2] * s) * radius,
      ]));
    }

    rings.push(ring);
  }

  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    for (let level = 0; level < rings.length; level++) {
      const ring = rings[level]!;
      link(out, ring[i]!, ring[next]!);
      if (level < rings.length - 1) link(out, ring[i]!, rings[level + 1]![i]!);
    }
  }
}

function addLimb(out: WireMesh, shape: Extract<SimplifiedShape, { kind: 'limb' }>): void {
  const path = shape.path;
  const tangentAt = (i: number): [number, number, number] => {
    const a = path[Math.max(0, i - 1)]!;
    const b = path[Math.min(path.length - 1, i + 1)]!;
    return normalize3t(sub3t(b, a));
  };
  let frame = tubeFrame(tangentAt(0));
  const rings: number[][] = [];
  const walked: number[] = [0];
  let meanRadius = 0;
  for (let i = 1; i < path.length; i++) {
    walked.push(walked[i - 1]! + Math.hypot(
      path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1], path[i]![2] - path[i - 1]![2],
    ));
  }

  for (let i = 0; i < path.length; i++) meanRadius += shape.radii[i]! / path.length;
  const span = walked[walked.length - 1]!;
  const segments = aroundSteps(2 * Math.PI * meanRadius);
  const levels = stepsOf(span, 4);
  const at = (distance: number) => {
    let i = 0;
    while (i < path.length - 2 && walked[i + 1]! < distance) i++;
    const a = path[i]!;
    const b = path[i + 1]!;
    const run = walked[i + 1]! - walked[i]!;
    const t = run < 1e-9 ? 0 : (distance - walked[i]!) / run;
    return {
      centre: [
        a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
      ] as [number, number, number],
      radius: shape.radii[i]! + (shape.radii[i + 1]! - shape.radii[i]!) * t,
      tangent: normalize3t(sub3t(b, a)),
    };
  };
  for (let level = 0; level <= levels; level++) {
    const { centre, radius, tangent } = at((span * level) / levels);
    frame = advanceFrame(frame, tangent);
    const ring: number[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      ring.push(pushVertex(out, [
        centre[0] + (frame.u[0] * c + frame.v[0] * s) * radius,
        centre[1] + (frame.u[1] * c + frame.v[1] * s) * radius,
        centre[2] + (frame.u[2] * c + frame.v[2] * s) * radius,
      ]));
    }

    rings.push(ring);
  }

  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    for (let level = 0; level < rings.length; level++) {
      link(out, rings[level]![i]!, rings[level]![next]!);
      if (level < rings.length - 1) link(out, rings[level]![i]!, rings[level + 1]![i]!);
    }
  }
}

function addTorso(out: WireMesh, shape: Extract<SimplifiedShape, { kind: 'torso' }>): void {
  const rings: number[][] = [];
  const segments = aroundSteps(ellipsePerimeter(shape.rx, shape.rz));
  const levels = stepsOf(shape.topY - shape.bottomY, 2);
  for (let level = 0; level <= levels; level++) {
    const t = level / levels;
    const y = shape.bottomY + (shape.topY - shape.bottomY) * t;
    const ring: number[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      ring.push(pushVertex(out, [
        shape.centreX + shape.rx * Math.cos(angle),
        y,
        shape.centreZ + shape.rz * Math.sin(angle),
      ]));
    }

    rings.push(ring);
  }

  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    for (let level = 0; level < rings.length; level++) {
      const ring = rings[level]!;
      link(out, ring[i]!, ring[next]!);
      if (level < rings.length - 1) link(out, ring[i]!, rings[level + 1]![i]!);
    }
  }
}

function addEllipsoid(out: WireMesh, shape: Extract<SimplifiedShape, { kind: 'ellipsoid' }>): void {
  const rings: number[][] = [];
  const segments = aroundSteps(ellipsePerimeter(shape.radii[0], shape.radii[2]));
  const levels = stepsOf(Math.PI * shape.radii[1], 4);
  for (let ring = 0; ring <= levels; ring++) {
    const phi = (ring / levels) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const row: number[] = [];
    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      row.push(pushVertex(out, [
        shape.centre[0] + shape.radii[0] * Math.cos(theta) * sinPhi,
        shape.centre[1] + shape.radii[1] * cosPhi,
        shape.centre[2] + shape.radii[2] * Math.sin(theta) * sinPhi,
      ]));
    }

    rings.push(row);
  }

  for (let ring = 0; ring < levels; ring++) {
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      link(out, rings[ring]![i]!, rings[ring]![next]!);
      link(out, rings[ring]![i]!, rings[ring + 1]![i]!);
    }
  }
}

function addBox(out: WireMesh, shape: Extract<SimplifiedShape, { kind: 'box' }>): void {
  const { min, max } = shape;
  const corners: Array<[number, number, number]> = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]],
    [max[0], min[1], max[2]], [min[0], min[1], max[2]],
    [min[0], max[1], min[2]], [max[0], max[1], min[2]],
    [max[0], max[1], max[2]], [min[0], max[1], max[2]],
  ];
  const ids = corners.map(corner => pushVertex(out, corner));
  for (const [a, b] of [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]) link(out, ids[a]!, ids[b]!);
}

function proxyMesh(shapes: readonly SimplifiedShape[]): MeshDesc {
  const out: WireMesh = { positions: [], colors: [], index: [] };
  for (const shape of shapes) {
    if (shape.kind === 'tube') addTube(out, shape);
    else if (shape.kind === 'limb') addLimb(out, shape);
    else if (shape.kind === 'torso') addTorso(out, shape);
    else if (shape.kind === 'ellipsoid') addEllipsoid(out, shape);
    else addBox(out, shape);
  }

  return {
    topology: 'line',
    streams: {
      position: new Float32Array(out.positions),
      color: new Float32Array(out.colors),
    },
    index: new Uint32Array(out.index),
  };
}

export class SimplifiedBodyStage {
  private readonly meshId: MeshId;
  private readonly entity: EntityId;
  private visible = false;

  constructor(private readonly host: PresenterHost, params: AvatarParams, transform?: ObjectTransform) {
    const shapes = bodyLandmarks(params).bodyShapes();
    const writer = host.writer;
    this.meshId = writer.createMesh(proxyMesh(shapes));
    this.entity = writer.createEntity({
      layer: 'gizmo',
      tags: ['simplifiedModel'],
      mesh: { kind: 'mesh', id: this.meshId },
      channels: CHANNEL_RASTER,
      transform: guideTransform(transform),
    });
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.host.writer.updateEntity(this.entity, {
      tags: visible ? ['simplifiedModel', 'wireGuide'] : ['simplifiedModel'],
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

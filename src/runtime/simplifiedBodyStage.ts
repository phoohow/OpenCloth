/** Builds the simplified body model as a latitude/longitude line grid for the wire pass. */

import type { AvatarParams, ObjectTransform } from '@/model/types';
import { bodyLandmarks, tubeFrame, type SimplifiedShape } from '@/avatar';
import { hexToLinearRgb } from '@/base/color';
import { normalize3t } from '@/base/math';
import { CHANNEL_RASTER } from '@/render/world';
import type { EntityId, MeshDesc, MeshId } from '@/render/world';
import type { PresenterHost } from '@/runtime/presenters/host';

/** Angular and axial resolution of the proxy line grid. */
const TUBE_SEGMENTS = 16;
const TUBE_LENGTH_SEGMENTS = 8;
/** Rings drawn along one limb; the joint lands between two of them. */
const LIMB_RINGS = 14;
const TORSO_SEGMENTS = 32;
const TORSO_HEIGHT_SEGMENTS = 16;
const HEAD_SEGMENTS = 24;
const HEAD_RINGS = 12;

/** Display colour of the proxy grid, as sRGB hex; vertex colours are read in linear light. */
const PROXY_COLOR = '#73b894';

/** Positions, per-vertex colours and line index pairs of the wire grid. */
interface WireMesh {
  positions: number[];
  colors: number[];
  index: number[];
}

/** Appends one vertex and returns its index. */
function pushVertex(out: WireMesh, p: readonly [number, number, number]): number {
  const index = out.positions.length / 3;
  out.positions.push(p[0], p[1], p[2]);
  const color = hexToLinearRgb(PROXY_COLOR);
  out.colors.push(color[0], color[1], color[2]);
  return index;
}

/** Connects two existing vertices with one line segment. */
function link(out: WireMesh, a: number, b: number): void {
  out.index.push(a, b);
}

/** Adds the meridians and latitude rings of a capped circular frustum. */
function addTube(out: WireMesh, shape: Extract<SimplifiedShape, { kind: 'tube' }>): void {
  const axis = normalize3t([
    shape.to[0] - shape.from[0],
    shape.to[1] - shape.from[1],
    shape.to[2] - shape.from[2],
  ]);
  const { u, v } = tubeFrame(axis);
  const rings: number[][] = [];
  for (let level = 0; level <= TUBE_LENGTH_SEGMENTS; level++) {
    const t = level / TUBE_LENGTH_SEGMENTS;
    const centre: [number, number, number] = [
      shape.from[0] + (shape.to[0] - shape.from[0]) * t,
      shape.from[1] + (shape.to[1] - shape.from[1]) * t,
      shape.from[2] + (shape.to[2] - shape.from[2]) * t,
    ];
    const radius = shape.fromR + (shape.toR - shape.fromR) * t;
    const ring: number[] = [];
    for (let i = 0; i < TUBE_SEGMENTS; i++) {
      const angle = (i / TUBE_SEGMENTS) * Math.PI * 2;
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
  for (let i = 0; i < TUBE_SEGMENTS; i++) {
    const next = (i + 1) % TUBE_SEGMENTS;
    for (let level = 0; level < rings.length; level++) {
      const ring = rings[level]!;
      link(out, ring[i]!, ring[next]!);
      if (level < rings.length - 1) link(out, ring[i]!, rings[level + 1]![i]!);
    }
  }
}

/** Adds the rings and meridians of a limb swept along its sampled centreline. */
function addLimb(out: WireMesh, shape: Extract<SimplifiedShape, { kind: 'limb' }>): void {
  const path = shape.path;
  const tangentAt = (i: number): [number, number, number] => {
    const a = path[Math.max(0, i - 1)]!;
    const b = path[Math.min(path.length - 1, i + 1)]!;
    return normalize3t([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  };
  // Frames are carried along the path instead of rebuilt from a fixed reference, so the grid keeps
  // its orientation over the bend and never pinches where the sections turn.
  let frame = tubeFrame(tangentAt(0));
  const rings: number[][] = [];
  const last = path.length - 1;
  for (let level = 0; level <= LIMB_RINGS; level++) {
    const index = Math.round((last * level) / LIMB_RINGS);
    const tangent = tangentAt(index);
    // Project the previous across-section onto the new normal plane, then square it up.
    const along = tangent[0] * frame.u[0] + tangent[1] * frame.u[1] + tangent[2] * frame.u[2];
    const carried: [number, number, number] = [
      frame.u[0] - tangent[0] * along,
      frame.u[1] - tangent[1] * along,
      frame.u[2] - tangent[2] * along,
    ];
    const u = normalize3t(carried);
    frame = { u, v: normalize3t([
      tangent[1] * u[2] - tangent[2] * u[1],
      tangent[2] * u[0] - tangent[0] * u[2],
      tangent[0] * u[1] - tangent[1] * u[0],
    ]) };
    const centre = path[index]!;
    const radius = shape.radii[index]!;
    const ring: number[] = [];
    for (let i = 0; i < TUBE_SEGMENTS; i++) {
      const angle = (i / TUBE_SEGMENTS) * Math.PI * 2;
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
  for (let i = 0; i < TUBE_SEGMENTS; i++) {
    const next = (i + 1) % TUBE_SEGMENTS;
    for (let level = 0; level < rings.length; level++) {
      link(out, rings[level]![i]!, rings[level]![next]!);
      if (level < rings.length - 1) link(out, rings[level]![i]!, rings[level + 1]![i]!);
    }
  }
}

/** Adds the meridians and height rings of the torso cylinder. */
function addTorso(out: WireMesh, shape: Extract<SimplifiedShape, { kind: 'torso' }>): void {
  const rings: number[][] = [];
  for (let level = 0; level <= TORSO_HEIGHT_SEGMENTS; level++) {
    const t = level / TORSO_HEIGHT_SEGMENTS;
    const y = shape.bottomY + (shape.topY - shape.bottomY) * t;
    const ring: number[] = [];
    for (let i = 0; i < TORSO_SEGMENTS; i++) {
      const angle = (i / TORSO_SEGMENTS) * Math.PI * 2;
      ring.push(pushVertex(out, [
        shape.centreX + shape.rx * Math.cos(angle),
        y,
        shape.centreZ + shape.rz * Math.sin(angle),
      ]));
    }
    rings.push(ring);
  }
  for (let i = 0; i < TORSO_SEGMENTS; i++) {
    const next = (i + 1) % TORSO_SEGMENTS;
    for (let level = 0; level < rings.length; level++) {
      const ring = rings[level]!;
      link(out, ring[i]!, ring[next]!);
      if (level < rings.length - 1) link(out, ring[i]!, rings[level + 1]![i]!);
    }
  }
}

/** Adds the longitude lines and latitude rings of the head ellipsoid. */
function addEllipsoid(out: WireMesh, shape: Extract<SimplifiedShape, { kind: 'ellipsoid' }>): void {
  const rings: number[][] = [];
  for (let ring = 0; ring <= HEAD_RINGS; ring++) {
    const phi = (ring / HEAD_RINGS) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const row: number[] = [];
    for (let i = 0; i < HEAD_SEGMENTS; i++) {
      const theta = (i / HEAD_SEGMENTS) * Math.PI * 2;
      row.push(pushVertex(out, [
        shape.centre[0] + shape.radii[0] * Math.cos(theta) * sinPhi,
        shape.centre[1] + shape.radii[1] * cosPhi,
        shape.centre[2] + shape.radii[2] * Math.sin(theta) * sinPhi,
      ]));
    }
    rings.push(row);
  }
  for (let ring = 0; ring < HEAD_RINGS; ring++) {
    for (let i = 0; i < HEAD_SEGMENTS; i++) {
      const next = (i + 1) % HEAD_SEGMENTS;
      link(out, rings[ring]![i]!, rings[ring]![next]!);
      link(out, rings[ring]![i]!, rings[ring + 1]![i]!);
    }
  }
}

/** Adds the twelve edges of an axis-aligned box. */
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

/** Latitude/longitude line mesh of every proxy shape. */
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

/** Simplified body model: one line-grid mesh drawn by the renderer's wire pass. */
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
      transform: worldTransform(transform),
    });
  }

  /** Shows or hides the grid; a shown grid carries the tag the wire pass draws. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.host.writer.updateEntity(this.entity, {
      tags: visible ? ['simplifiedModel', 'wireGuide'] : ['simplifiedModel'],
    });
  }

  /** Moves the model with the body. */
  place(transform?: ObjectTransform): void {
    this.host.writer.updateEntity(this.entity, { transform: worldTransform(transform) });
  }

  /** Removes the model from the world and frees its records. */
  dispose(): void {
    const writer = this.host.writer;
    writer.destroyEntity(this.entity);
    writer.destroyMesh(this.meshId);
  }
}

/** World transform of an avatar transform. */
function worldTransform(transform?: ObjectTransform) {
  return {
    position: transform?.position ?? { x: 0, y: 0, z: 0 },
    rotationEuler: transform?.rotationEuler ?? { x: 0, y: 0, z: 0 },
    scale: transform?.scale ?? { x: 1, y: 1, z: 1 },
  };
}

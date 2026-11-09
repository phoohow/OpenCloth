/** Instanced 3D trims drawn above the cloth surface. */

import type { Project, TrimKind, Vec2 } from '@/model/types';
import { hexToLinearRgb } from '@/base/color';
import type { TriangleMesh } from '@/pattern/triangulate';
import { CHANNEL_RASTER } from '@/render/world';
import type { EntityId, MaterialData, MaterialId, MeshData, MeshId, WorldWriter } from '@/render/world';
import type { PresenterHost } from '@/runtime/presenters/host';
import type { ClothSimInput } from '@/sim';

/** One 3D trim placed on the cloth. */
export interface TrimInstance {
  trimId: string;
  kind: TrimKind;
  color: string;
  /** Merged cloth particle the trim rides. */
  particle: number;
  /** Trim diameter in meters. */
  diameter: number;
}

/** Axis of the base geometry that must point along the cloth normal. */
type TrimAxis = 'x' | 'y' | 'z' | 'none';

const TRIM_AXIS: Record<TrimKind, TrimAxis> = {
  button: 'y',
  eyelet: 'z',
  rivet: 'none',
  snap: 'y',
};

/** Trim kinds, in the order their batches are written. */
const TRIM_KINDS: readonly TrimKind[] = ['button', 'eyelet', 'rivet', 'snap'];

/** Distance a trim sits above the cloth surface, in meters. */
const TRIM_LIFT_M = 0.0003;

/** Trims of visible panels, each snapped to the nearest merged cloth particle. */
export function trimInstances(project: Project, panels: ClothSimInput['panels']): TrimInstance[] {
  const pattern = project.pattern;
  const out: TrimInstance[] = [];
  for (const panel of panels) {
    if (pattern.panels[panel.panelId]?.visible === false) continue;
    const trims = Object.values(pattern.trims ?? {}).filter(
      trim => trim.panelId === panel.panelId && trim.visible !== false,
    );
    if (trims.length === 0) continue;
    for (const trim of trims) {
      const local = nearestVertex(panel.mesh, trim.pos);
      if (local < 0) continue;
      out.push({
        trimId: trim.id,
        kind: trim.kind,
        color: trim.color,
        particle: panel.vertexOffset + local,
        diameter: Math.max(0.4, trim.sizeMm / 10) / 100,
      });
    }
  }
  return out;
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

/** Trims of one kind: one instanced mesh, its entity and the instance buffers. */
interface TrimBatch {
  readonly kind: TrimKind;
  readonly instances: TrimInstance[];
  readonly meshId: MeshId;
  readonly entityId: EntityId;
  readonly matrices: Float32Array;
  readonly colors: Float32Array;
}

/** Instanced 3D trims drawn above the cloth, one instanced mesh per kind. */
export class TrimInstances {
  private writer: WorldWriter | null = null;
  private materialId: MaterialId | null = null;
  private batches: TrimBatch[] = [];

  /** Builds one instanced mesh per trim kind and writes its entity. */
  attach(
    host: PresenterHost, instances: TrimInstance[], positions: Float32Array, normals?: Float32Array,
  ): void {
    this.detach(host);
    if (instances.length === 0) return;
    const writer = host.writer;
    this.writer = writer;
    this.materialId = writer.createMaterial(trimMaterial());
    for (const kind of TRIM_KINDS) {
      const list = instances.filter(instance => instance.kind === kind);
      if (list.length === 0) continue;
      const matrices = new Float32Array(list.length * 16);
      const colors = new Float32Array(list.length * 3);
      list.forEach((instance, index) => {
        colors.set(hexToLinearRgb(instance.color), index * 3);
      });
      const meshId = writer.createMesh({
        ...trimMesh(kind),
        instances: { count: list.length, matrices, colors },
      });
      const entityId = writer.createEntity({
        layer: 'overlay',
        tags: ['trims'],
        mesh: { kind: 'mesh', id: meshId },
        materials: [{ kind: 'material', id: this.materialId }],
        channels: CHANNEL_RASTER,
      });
      host.bind('trims', entityId);
      this.batches.push({ kind, instances: list, meshId, entityId, matrices, colors });
    }
    this.update(positions, normals);
  }

  /** Rewrites every instance transform from the current cloth positions and normals. */
  update(positions: Float32Array, normals?: Float32Array): void {
    const writer = this.writer;
    if (writer === null) return;
    for (const batch of this.batches) {
      writeInstanceMatrices(batch, positions, normals);
      writer.updateMesh(batch.meshId, {
        instances: { count: batch.instances.length, matrices: batch.matrices, colors: batch.colors },
      });
    }
  }

  /** Shows or hides the trims together with the cloth beneath them. */
  setVisible(visible: boolean): void {
    const writer = this.writer;
    if (writer === null) return;
    const channels = visible ? CHANNEL_RASTER : 0;
    for (const batch of this.batches) writer.updateEntity(batch.entityId, { channels });
  }

  /** Removes every batch from the world and frees its geometries. */
  detach(host: PresenterHost): void {
    const writer = host.writer;
    for (const batch of this.batches) {
      host.unbind(batch.entityId);
      writer.destroyEntity(batch.entityId);
      writer.destroyMesh(batch.meshId);
    }
    if (this.materialId !== null) writer.destroyMaterial(this.materialId);
    this.batches = [];
    this.materialId = null;
    this.writer = null;
  }
}

/** Shared metal material of every trim instance. */
function trimMaterial(): MaterialData {
  return {
    kind: 'surface',
    name: 'trims',
    vertexColors: true,
    metalness: 0.55,
    roughness: 0.35,
    side: 'double',
  };
}

/** Column-major instance matrix of each trim, oriented along the cloth normal. */
function writeInstanceMatrices(
  batch: TrimBatch, positions: Float32Array, normals?: Float32Array,
): void {
  const matrices = batch.matrices;
  const axis = TRIM_AXIS[batch.kind];
  batch.instances.forEach((instance, index) => {
    const base = index * 16;
    const offset = instance.particle * 3;
    if (offset + 2 >= positions.length) {
      matrices.fill(0, base, base + 16);
      return;
    }
    const [nx, ny, nz] = clothNormal(instance.particle, normals);
    const scale = instance.diameter;
    const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = normalBasis(axis, nx, ny, nz);
    matrices[base] = xx * scale;
    matrices[base + 1] = xy * scale;
    matrices[base + 2] = xz * scale;
    matrices[base + 3] = 0;
    matrices[base + 4] = yx * scale;
    matrices[base + 5] = yy * scale;
    matrices[base + 6] = yz * scale;
    matrices[base + 7] = 0;
    matrices[base + 8] = zx * scale;
    matrices[base + 9] = zy * scale;
    matrices[base + 10] = zz * scale;
    matrices[base + 11] = 0;
    matrices[base + 12] = positions[offset] + nx * TRIM_LIFT_M;
    matrices[base + 13] = positions[offset + 1] + ny * TRIM_LIFT_M;
    matrices[base + 14] = positions[offset + 2] + nz * TRIM_LIFT_M;
    matrices[base + 15] = 1;
  });
}

/** Cloth normal at one particle, or up when the readback carries none. */
function clothNormal(particle: number, normals?: Float32Array): readonly [number, number, number] {
  const offset = particle * 3;
  if (normals && offset + 2 < normals.length) {
    const x = normals[offset];
    const y = normals[offset + 1];
    const z = normals[offset + 2];
    const len = Math.hypot(x, y, z);
    if (len > 1e-9) return [x / len, y / len, z / len];
  }
  return [0, 1, 0];
}

/**
 * Rotation columns that take the trim's base axis onto the cloth normal, laid out as the
 * components of the x, y and z columns.
 */
function normalBasis(
  axis: TrimAxis, nx: number, ny: number, nz: number,
): readonly [number, number, number, number, number, number, number, number, number] {
  if (axis === 'none') return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const helperX = Math.abs(ny) > 0.9 ? 1 : 0;
  const helperY = Math.abs(ny) > 0.9 ? 0 : 1;
  // First column: helper × normal.
  let xx = helperY * nz;
  let xy = -helperX * nz;
  let xz = helperX * ny - helperY * nx;
  const len = Math.hypot(xx, xy, xz) || 1;
  xx /= len;
  xy /= len;
  xz /= len;
  if (axis === 'z') {
    // x × normal is the second column, leaving the normal as the third.
    const yx = ny * xz - nz * xy;
    const yy = nz * xx - nx * xz;
    const yz = nx * xy - ny * xx;
    return [xx, xy, xz, yx, yy, yz, nx, ny, nz];
  }
  // The normal is the second column and x × normal the third.
  const zx = xy * nz - xz * ny;
  const zy = xz * nx - xx * nz;
  const zz = xx * ny - xy * nx;
  return [xx, xy, xz, nx, ny, nz, zx, zy, zz];
}

/** Base geometry of one trim kind, sized to a unit diameter. */
function trimMesh(kind: TrimKind): MeshData {
  if (kind === 'button') return cylinderMesh(0.5, 0.16, 20);
  if (kind === 'eyelet') return torusMesh(0.45, 0.1, 10, 24);
  if (kind === 'snap') return cylinderMesh(0.5, 0.1, 20);
  return ellipsoidMesh(0.5, 16, 10, 0.35);
}

type Triple = readonly [number, number, number];

/** Cylinder around the Y axis, with capped ends. */
function cylinderMesh(radius: number, height: number, segments: number): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const half = height / 2;
  const up: Triple = [0, 1, 0];
  const down: Triple = [0, -1, 0];
  const topCenter: Triple = [0, half, 0];
  const bottomCenter: Triple = [0, -half, 0];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const n0: Triple = [c0, 0, s0];
    const n1: Triple = [c1, 0, s1];
    const bottom0: Triple = [c0 * radius, -half, s0 * radius];
    const top0: Triple = [c0 * radius, half, s0 * radius];
    const bottom1: Triple = [c1 * radius, -half, s1 * radius];
    const top1: Triple = [c1 * radius, half, s1 * radius];
    triangle(positions, normals, bottom0, bottom1, top1, n0, n1, n1);
    triangle(positions, normals, bottom0, top1, top0, n0, n1, n0);
    triangle(positions, normals, topCenter, top0, top1, up, up, up);
    triangle(positions, normals, bottomCenter, bottom1, bottom0, down, down, down);
  }
  return surfaceMesh(positions, normals);
}

/** Torus around the Z axis. */
function torusMesh(radius: number, tube: number, radial: number, tubular: number): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < tubular; i++) {
    const u0 = (i / tubular) * Math.PI * 2;
    const u1 = ((i + 1) / tubular) * Math.PI * 2;
    for (let j = 0; j < radial; j++) {
      const v0 = (j / radial) * Math.PI * 2;
      const v1 = ((j + 1) / radial) * Math.PI * 2;
      const p00 = torusPoint(radius, tube, u0, v0);
      const p10 = torusPoint(radius, tube, u1, v0);
      const p11 = torusPoint(radius, tube, u1, v1);
      const p01 = torusPoint(radius, tube, u0, v1);
      const n00 = torusNormal(u0, v0);
      const n10 = torusNormal(u1, v0);
      const n11 = torusNormal(u1, v1);
      const n01 = torusNormal(u0, v1);
      triangle(positions, normals, p00, p10, p11, n00, n10, n11);
      triangle(positions, normals, p00, p11, p01, n00, n11, n01);
    }
  }
  return surfaceMesh(positions, normals);
}

function torusPoint(radius: number, tube: number, u: number, v: number): Triple {
  const ring = radius + tube * Math.cos(v);
  return [ring * Math.cos(u), ring * Math.sin(u), tube * Math.sin(v)];
}

function torusNormal(u: number, v: number): Triple {
  const cv = Math.cos(v);
  return [cv * Math.cos(u), cv * Math.sin(u), Math.sin(v)];
}

/** Sphere squashed along Z into a rivet head. */
function ellipsoidMesh(radius: number, segments: number, rings: number, zScale: number): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let ring = 0; ring < rings; ring++) {
    const phi0 = (ring / rings) * Math.PI;
    const phi1 = ((ring + 1) / rings) * Math.PI;
    for (let seg = 0; seg < segments; seg++) {
      const theta0 = (seg / segments) * Math.PI * 2;
      const theta1 = ((seg + 1) / segments) * Math.PI * 2;
      const p00 = ellipsoidPoint(radius, zScale, phi0, theta0);
      const p10 = ellipsoidPoint(radius, zScale, phi0, theta1);
      const p11 = ellipsoidPoint(radius, zScale, phi1, theta1);
      const p01 = ellipsoidPoint(radius, zScale, phi1, theta0);
      const n00 = ellipsoidNormal(zScale, phi0, theta0);
      const n10 = ellipsoidNormal(zScale, phi0, theta1);
      const n11 = ellipsoidNormal(zScale, phi1, theta1);
      const n01 = ellipsoidNormal(zScale, phi1, theta0);
      triangle(positions, normals, p00, p10, p11, n00, n10, n11);
      triangle(positions, normals, p00, p11, p01, n00, n11, n01);
    }
  }
  return surfaceMesh(positions, normals);
}

function ellipsoidPoint(radius: number, zScale: number, phi: number, theta: number): Triple {
  const sinPhi = Math.sin(phi);
  return [
    radius * sinPhi * Math.cos(theta),
    radius * Math.cos(phi),
    radius * zScale * sinPhi * Math.sin(theta),
  ];
}

function ellipsoidNormal(zScale: number, phi: number, theta: number): Triple {
  const sinPhi = Math.sin(phi);
  const x = sinPhi * Math.cos(theta);
  const y = Math.cos(phi);
  const z = (sinPhi * Math.sin(theta)) / zScale;
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

/** Appends one triangle with per-corner positions and normals. */
function triangle(
  positions: number[], normals: number[],
  a: Triple, b: Triple, c: Triple,
  na: Triple, nb: Triple, nc: Triple,
): void {
  positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  normals.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
}

/** Triangle soup with normals and the white vertex colors instance colors tint. */
function surfaceMesh(positions: number[], normals: number[]): MeshData {
  return {
    topology: 'triangle',
    streams: {
      position: new Float32Array(positions),
      normal: new Float32Array(normals),
      color: new Float32Array(positions.length).fill(1),
    },
  };
}

import type { FloorConfig, ObjectTransform } from '@/model/types';
import type { ChannelMask, EntityId, MaterialId, MeshDesc, MeshId } from '@/render/world';
import type { PresenterHost } from '@/runtime/world/presenters/host';

import { IDENTITY_TRANSFORM, normalizeFloor } from '@/model';
import { CHANNEL_RASTER, CHANNEL_TRACE } from '@/render/world';

const FLOOR_COLOR = '#7f8b99';

const FLOOR_OPACITY = 0.5;

const GRID_COLOR_AXIS = '#f6fafd';

const GRID_COLOR_CELL = '#e4ebf2';

const GRID_OPACITY = 0.5;

interface StagePart {
  id: EntityId;
  channels: ChannelMask;
  grid: boolean;
}

export class StagePresenter {
  private readonly meshes: MeshId[] = [];
  private readonly parts: StagePart[] = [];
  private readonly materials: MaterialId[] = [];
  private floorMeshId: MeshId | null = null;
  private gridMeshId: MeshId | null = null;
  private geometry = '';
  private visible = true;
  private gridVisible = true;

  constructor(private readonly host: PresenterHost) {}

  create(): void {
    const writer = this.host.writer;
    const initial = normalizeFloor(undefined);
    this.geometry = `${initial.width}:${initial.depth}:${initial.gridSpacing}`;
    const floor = writer.createMesh(floorMesh(initial.width, initial.depth));
    this.meshes.push(floor);
    this.floorMeshId = floor;

    const rasterFloor = writer.createMaterial({
      kind: 'unlit',
      name: 'floor',
      color: FLOOR_COLOR,
      opacity: FLOOR_OPACITY,
      blending: 'alpha',
      depthWrite: false,
      side: 'double',
    });
    this.materials.push(rasterFloor);
    this.parts.push({
      id: writer.createEntity({
        layer: 'underlay',
        mesh: { kind: 'mesh', id: floor },
        materials: [{ kind: 'material', id: rasterFloor }],
        channels: CHANNEL_RASTER,
      }),
      channels: CHANNEL_RASTER,
      grid: false,
    });

    const tracedFloor = writer.createMaterial({
      kind: 'surface',
      name: 'floor-traced',
      color: FLOOR_COLOR,
      roughness: 0.9,
      opacity: FLOOR_OPACITY,
      blending: 'alpha',
      side: 'double',
    });
    this.materials.push(tracedFloor);
    this.parts.push({
      id: writer.createEntity({
        layer: 'underlay',
        mesh: { kind: 'mesh', id: floor },
        materials: [{ kind: 'material', id: tracedFloor }],
        channels: CHANNEL_TRACE,
      }),
      channels: CHANNEL_TRACE,
      grid: false,
    });

    const grid = writer.createMesh(gridLineMesh(initial.width, initial.depth, initial.gridSpacing));
    this.meshes.push(grid);
    this.gridMeshId = grid;
    const gridMaterial = writer.createMaterial({
      kind: 'line',
      name: 'grid',
      vertexColors: true,
      opacity: GRID_OPACITY,
      blending: 'alpha',
      depthWrite: false,
      side: 'double',
    });
    this.materials.push(gridMaterial);
    this.parts.push({
      id: writer.createEntity({
        layer: 'gizmo',
        mesh: { kind: 'mesh', id: grid },
        materials: [{ kind: 'material', id: gridMaterial }],
        channels: CHANNEL_RASTER,
      }),
      channels: CHANNEL_RASTER,
      grid: true,
    });
  }

  configure(raw?: Partial<FloorConfig>): void {
    const floor = normalizeFloor(raw);
    const signature = `${floor.width}:${floor.depth}:${floor.gridSpacing}`;
    const writer = this.host.writer;
    if (signature !== this.geometry) {
      this.geometry = signature;
      if (this.floorMeshId !== null) writer.updateMesh(this.floorMeshId, floorMesh(floor.width, floor.depth));
      if (this.gridMeshId !== null) {
        writer.updateMesh(this.gridMeshId, gridLineMesh(floor.width, floor.depth, floor.gridSpacing));
      }
    }

    this.gridVisible = floor.gridVisible;
    this.applyTransform(floor.transform);
    this.applyChannels();
  }

  setTransform(transform: ObjectTransform | undefined): void {
    this.applyTransform(transform);
  }

  private applyTransform(transform: ObjectTransform | undefined): void {
    const pose = transform ?? IDENTITY_TRANSFORM;
    for (const part of this.parts) this.host.writer.updateEntity(part.id, { transform: pose });
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.applyChannels();
  }

  private applyChannels(): void {
    for (const part of this.parts) {
      const shown = this.visible && (!part.grid || this.gridVisible);
      this.host.writer.updateEntity(part.id, { channels: shown ? part.channels : 0 });
    }
  }

  dispose(): void {
    const writer = this.host.writer;
    for (const part of this.parts) writer.destroyEntity(part.id);
    for (const id of this.meshes) writer.destroyMesh(id);
    for (const id of this.materials) writer.destroyMaterial(id);
    this.parts.length = 0;
    this.meshes.length = 0;
    this.materials.length = 0;
  }
}

function floorMesh(width: number, depth: number): MeshDesc {
  const halfW = width / 2;
  const halfD = depth / 2;
  return {
    topology: 'triangle',
    streams: {
      position: new Float32Array([
        -halfW, 0, -halfD, halfW, 0, -halfD, halfW, 0, halfD, -halfW, 0, halfD,
      ]),
      normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    },
    index: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

function gridLineMesh(width: number, depth: number, spacing: number): MeshDesc {
  const halfW = width / 2;
  const halfD = depth / 2;
  const acrossX = Math.max(1, Math.round(width / spacing));
  const acrossZ = Math.max(1, Math.round(depth / spacing));
  const stepX = width / acrossX;
  const stepZ = depth / acrossZ;
  const positions: number[] = [];
  const colors: number[] = [];
  const axis = hexTriplet(GRID_COLOR_AXIS);
  const cell = hexTriplet(GRID_COLOR_CELL);
  const pushLine = (color: number[], ax: number, az: number, bx: number, bz: number) => {
    positions.push(ax, 0, az, bx, 0, bz);
    colors.push(...color, ...color);
  };
  for (let i = 0; i <= acrossX; i++) {
    const x = -halfW + i * stepX;
    pushLine(Math.abs(x) < stepX / 2 ? axis : cell, x, -halfD, x, halfD);
  }

  for (let i = 0; i <= acrossZ; i++) {
    const z = -halfD + i * stepZ;
    pushLine(Math.abs(z) < stepZ / 2 ? axis : cell, -halfW, z, halfW, z);
  }

  return {
    topology: 'line',
    streams: { position: new Float32Array(positions), color: new Float32Array(colors) },
  };
}

function hexTriplet(hex: string): number[] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

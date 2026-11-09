/** The stage floor and its reference grid, as world meshes. */

import type { PresenterHost } from '@/runtime/presenters/host';
import { CHANNEL_RASTER, CHANNEL_TRACE } from '@/render/world';
import type { EntityId, MaterialId, MeshDesc, MeshId } from '@/render/world';

/** Stage floor colour and transparency. */
const FLOOR_COLOR = '#7f8b99';
const FLOOR_OPACITY = 0.5;

/** Edge length of the stage floor and of its reference grid, in meters. */
const FLOOR_SIZE = 20;

/** Grid cells across the stage floor; one cell per meter. */
const GRID_DIVISIONS = 20;

/** Grid tones: centre axis, then cell lines. */
const GRID_COLOR_AXIS = '#f6fafd';
const GRID_COLOR_CELL = '#e4ebf2';
const GRID_OPACITY = 0.5;

/** Builds the floor and grid entities once; the world keeps them for the scene's lifetime. */
export class StagePresenter {
  private readonly meshes: MeshId[] = [];
  private readonly entities: EntityId[] = [];
  private readonly materials: MaterialId[] = [];

  constructor(private readonly host: PresenterHost) { }

  /** Writes the raster floor, its traced surface and both grid forms. */
  create(): void {
    const writer = this.host.writer;
    const floor = writer.createMesh(floorMesh());
    this.meshes.push(floor);

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
    this.entities.push(writer.createEntity({
      layer: 'underlay',
      mesh: { kind: 'mesh', id: floor },
      materials: [{ kind: 'material', id: rasterFloor }],
      channels: CHANNEL_RASTER,
    }));

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
    this.entities.push(writer.createEntity({
      layer: 'underlay',
      mesh: { kind: 'mesh', id: floor },
      materials: [{ kind: 'material', id: tracedFloor }],
      channels: CHANNEL_TRACE,
    }));

    const grid = writer.createMesh(gridLineMesh());
    this.meshes.push(grid);
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
    // The grid is a screen-space guide, not scene geometry: a one-pixel line over the finished
    // image reads the same in raster and path-traced modes. As traced geometry it would be a
    // sub-pixel wide quad coplanar with the floor, which the sampler barely covers.
    this.entities.push(writer.createEntity({
      layer: 'gizmo',
      mesh: { kind: 'mesh', id: grid },
      materials: [{ kind: 'material', id: gridMaterial }],
      channels: CHANNEL_RASTER,
    }));
  }

  /** Frees the meshes this presenter owns. */
  dispose(): void {
    const writer = this.host.writer;
    for (const id of this.entities) writer.destroyEntity(id);
    for (const id of this.meshes) writer.destroyMesh(id);
    for (const id of this.materials) writer.destroyMaterial(id);
    this.entities.length = 0;
    this.meshes.length = 0;
    this.materials.length = 0;
  }
}

/** Two triangles of the stage floor, lying on the XZ plane. */
function floorMesh(): MeshDesc {
  const half = FLOOR_SIZE / 2;
  return {
    topology: 'triangle',
    streams: {
      position: new Float32Array([
        -half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half,
      ]),
      normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    },
    index: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

/** One line segment per grid line with its own colour. */
function gridLineMesh(): MeshDesc {
  const half = FLOOR_SIZE / 2;
  const step = FLOOR_SIZE / GRID_DIVISIONS;
  const positions: number[] = [];
  const colors: number[] = [];
  const axis = hexTriplet(GRID_COLOR_AXIS);
  const cell = hexTriplet(GRID_COLOR_CELL);
  for (let i = 0; i <= GRID_DIVISIONS; i++) {
    const offset = -half + i * step;
    const color = i === GRID_DIVISIONS / 2 ? axis : cell;
    positions.push(offset, 0, -half, offset, 0, half);
    positions.push(-half, 0, offset, half, 0, offset);
    for (let vertex = 0; vertex < 4; vertex++) colors.push(...color);
  }
  return {
    topology: 'line',
    streams: { position: new Float32Array(positions), color: new Float32Array(colors) },
  };
}

/** Linear rgb triplet of a hex colour. */
function hexTriplet(hex: string): number[] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/** The drawn garment: one world mesh, one surface material per slot and a scalar field stream. */

import type { FabricAppearance, Project } from '@/model/types';
import type { PanelMesh } from '@/pattern/panel';
import type { ClothSimInput } from '@/sim';
import { computeVertexNormals } from '@/base/geom';
import { clothMaterialSlotKey, clothMaterialSlotPlan } from '@/model';
import {
  CHANNEL_ALL, type EntityId, type MaterialDesc, type MaterialId, type MeshId,
} from '@/render/world';
import type { PresenterHost } from '@/runtime/presenters/host';
import { printPaint } from '@/runtime/presenters/printTextures';
import { FALLBACK_APPEARANCE } from '@/runtime/clothConstants';

/** Index range and material slot of one cloth geometry group. */
interface ClothGroupRange {
  start: number;
  count: number;
  slot: number;
  panelId: string;
}

/** What the cloth presenter reads from the rest of the engine. */
export interface ClothPresenterDeps {
  host: PresenterHost;
  /** Merged input the drawn mesh mirrors; null before a build. */
  input: () => ClothSimInput | null;
  /** Panel meshes in merged order, the source of the merged UVs. */
  panelMeshes: () => ReadonlyMap<string, PanelMesh>;
  /** Re-reads material physics into the solver. */
  refreshPhysics: (project: Project) => void;
}

/** Colour space each map slot is sampled in; only albedo carries sRGB colour. */
const MAP_COLOR_SPACE = {
  albedo: 'srgb', normal: 'linear', roughness: 'linear', metallic: 'linear',
} as const;

/** Writes the merged garment into the render world and mirrors simulation frames into it. */
export class ClothPresenter {
  private meshId: MeshId | null = null;
  private entity: EntityId | null = null;
  private materials: MaterialId[] = [];
  private slotKeys: string[] = [];
  private groups: ClothGroupRange[] = [];
  private textureKeys = new Set<string>();
  private pendingKeys = new Set<string>();
  /** Scalar heatmap stream, one value per merged particle. */
  private field: Float32Array | null = null;
  /** Positions the mesh currently draws, shared with the overlays. */
  private positions: Float32Array | null = null;
  private normals: Float32Array | null = null;
  private uvs: Float32Array | null = null;

  constructor(private readonly deps: ClothPresenterDeps) { }

  get entityId(): EntityId | null {
    return this.entity;
  }

  get mesh(): MeshId | null {
    return this.meshId;
  }

  /** Builds the merged mesh and its material slots. */
  create(project: Project): void {
    const input = this.deps.input();
    if (!input) return;
    this.remove();
    const writer = this.deps.host.writer;
    this.field = new Float32Array(input.particleCount);
    this.positions = input.positions;
    this.normals = computeVertexNormals(input.positions, input.indices);
    this.uvs = mergedUVs(this.deps.panelMeshes(), input.particleCount);
    this.meshId = writer.createMesh({
      topology: 'triangle',
      streams: {
        position: input.positions,
        normal: this.normals,
        uv: this.uvs,
        field: this.field,
      },
      index: input.indices,
    });
    this.rebind(project);
    this.entity = writer.createEntity({
      layer: 'subject',
      tags: ['subjectSurface'],
      mesh: { kind: 'mesh', id: this.meshId },
      materials: this.materials.map(id => ({ kind: 'material', id })),
      channels: CHANNEL_ALL,
    });
    this.deps.host.bind('cloth', this.entity, triangle => this.panelAtTriangle(triangle));
  }

  /** Takes the mesh, materials and textures out of the world. */
  remove(): void {
    const writer = this.deps.host.writer;
    if (this.entity !== null) {
      this.deps.host.unbind(this.entity);
      writer.destroyEntity(this.entity);
    }
    if (this.meshId !== null) writer.destroyMesh(this.meshId);
    for (const id of this.materials) writer.destroyMaterial(id);
    for (const key of this.textureKeys) this.deps.host.textures.release(key);
    this.textureKeys.clear();
    this.pendingKeys.clear();
    this.meshId = null;
    this.entity = null;
    this.materials = [];
    this.slotKeys = [];
    this.groups = [];
    this.field = null;
    this.positions = null;
    this.normals = null;
    this.uvs = null;
  }

  /** Pushes simulated positions and normals into the mesh streams. */
  updateFromSim(positions: Float32Array, normals: Float32Array): void {
    if (this.meshId === null) return;
    this.positions = positions;
    this.normals = normals;
    this.deps.host.writer.updateMesh(this.meshId, { streams: { position: positions, normal: normals } });
  }

  /** Restores the mesh to a static layout and recomputes its normals. */
  resetTo(positions: Float32Array): void {
    const input = this.deps.input();
    if (this.meshId === null || !input) return;
    this.positions = positions;
    this.normals = computeVertexNormals(positions, input.indices);
    this.deps.host.writer.updateMesh(this.meshId, {
      streams: { position: positions, normal: this.normals },
    });
  }

  /** Copies the active analysis scalar field into the mesh stream. */
  setField(field: Float32Array): void {
    if (this.meshId === null || !this.field) return;
    this.field.set(field.subarray(0, this.field.length));
    this.deps.host.writer.updateMesh(this.meshId, { streams: { field: this.field } });
  }

  /** Clears the analysis field back to neutral. */
  clearField(): void {
    if (this.meshId === null || !this.field) return;
    this.field.fill(0);
    this.deps.host.writer.updateMesh(this.meshId, { streams: { field: this.field } });
  }

  /** Positions and normals of the surface the mesh currently draws, for overlays that share it. */
  surfaceData(): { positions: Float32Array; normals: Float32Array; uv: Float32Array } | null {
    if (!this.positions || !this.normals || !this.uvs) return null;
    return { positions: this.positions, normals: this.normals, uv: this.uvs };
  }

  /** Re-applies the material records to the built mesh; never rebuilds geometry. */
  applyFabrics(project: Project): void {
    if (this.meshId === null) return;
    const plan = clothMaterialSlotPlan(project, this.panelIds());
    const keys = plan.slots.map(clothMaterialSlotKey);
    const sameSlots = keys.length === this.slotKeys.length
      && keys.every((key, i) => key === this.slotKeys[i]);
    if (!sameSlots) {
      this.rebind(project);
    } else {
      this.pendingKeys = new Set();
      plan.slots.forEach((slot, i) => {
        const desc = this.materialDesc(project, slot, i);
        const { kind, ...patch } = desc;
        void kind;
        this.deps.host.writer.updateMaterial(this.materials[i]!, patch);
      });
      this.commitTextures();
    }
    this.deps.refreshPhysics(project);
  }

  /** Draws only the panels marked visible; hidden panels keep simulating. */
  applyPanelVisibility(project: Project): void {
    if (this.meshId === null || this.groups.length === 0) return;
    const groups = this.groups
      .filter(group => project.pattern.panels[group.panelId]?.visible !== false)
      .map(group => ({ start: group.start, count: group.count, materialSlot: group.slot }));
    this.deps.host.writer.updateMesh(this.meshId, { groups });
  }

  private panelIds(): string[] {
    return this.deps.input()?.panels.map(panel => panel.panelId) ?? [];
  }

  /** Panel owning one merged-mesh triangle, from the geometry group ranges. */
  private panelAtTriangle(triangle: number): string | null {
    const offset = triangle * 3;
    for (const group of this.groups) {
      if (offset >= group.start && offset < group.start + group.count) return group.panelId;
    }
    return null;
  }

  /** Rebuilds every material slot and the geometry groups that select them. */
  private rebind(project: Project): void {
    const input = this.deps.input();
    if (this.meshId === null || !input) return;
    const writer = this.deps.host.writer;
    const plan = clothMaterialSlotPlan(project, this.panelIds());
    for (const id of this.materials) writer.destroyMaterial(id);
    this.pendingKeys = new Set();
    this.materials = plan.slots.map((slot, i) => writer.createMaterial(this.materialDesc(project, slot, i)));
    this.slotKeys = plan.slots.map(clothMaterialSlotKey);

    let indexStart = 0;
    this.groups = input.panels.map((panel, i) => {
      const count = panel.mesh.indices.length;
      const group = { start: indexStart, count, slot: plan.slotForPanel[i]!, panelId: panel.panelId };
      indexStart += count;
      return group;
    });
    writer.updateMesh(this.meshId, {
      groups: this.groups.map(group => ({
        start: group.start, count: group.count, materialSlot: group.slot,
      })),
    });
    if (this.entity !== null) {
      writer.updateEntity(this.entity, {
        materials: this.materials.map(id => ({ kind: 'material', id })),
      });
    }
    this.applyPanelVisibility(project);
    this.commitTextures();
  }

  /** Descriptor of one material slot, with its maps registered in the texture port. */
  private materialDesc(
    project: Project,
    slot: { fabric: { appearance: FabricAppearance } | null; panelId: string | null },
    index: number,
  ): MaterialDesc {
    const app = slot.fabric?.appearance ?? FALLBACK_APPEARANCE;
    const maps: NonNullable<MaterialDesc['maps']> = {};
    let printed = false;
    if (slot.panelId) {
      const panelMesh = this.deps.panelMeshes().get(slot.panelId);
      const paint = panelMesh ? printPaint(project, slot.panelId, panelMesh.positions2D) : null;
      if (paint) {
        this.deps.host.textures.paint(paint.key, [paint.command]);
        this.pendingKeys.add(paint.key);
        maps.albedo = paint.key;
        printed = true;
      }
    }
    if (!printed) this.bindMaps(app, index, maps);
    return {
      kind: 'surface',
      name: slot.panelId ? `fabric:${slot.panelId}` : 'fabric',
      color: printed || maps.albedo ? '#ffffff' : app.baseColor,
      roughness: maps.roughness ? 1 : app.roughness,
      metalness: maps.metallic ? 1 : app.metallic,
      maps,
      side: 'double',
      sheen: app.sheenIntensity,
      sheenColor: app.sheenColor,
      sheenRoughness: app.sheenRoughness,
      transmission: app.transmission,
      thickness: app.thickness,
      clearcoat: app.clearcoat,
      clearcoatRoughness: app.clearcoatRoughness,
      anisotropy: app.anisotropy,
      iridescence: app.iridescence,
      normalScale: app.normalScale,
      uvTiling: app.uvTiling,
      uvOffset: app.uvOffset,
    };
  }

  /** Registers a slot's image maps under stable keys and returns their references. */
  private bindMaps(
    app: FabricAppearance, index: number, maps: NonNullable<MaterialDesc['maps']>,
  ): void {
    for (const slot of ['albedo', 'normal', 'roughness', 'metallic'] as const) {
      const url = app.maps?.[slot];
      if (!url) continue;
      const key = `fabric:${index}:${slot}`;
      this.deps.host.textures.load(key, url, {
        colorSpace: MAP_COLOR_SPACE[slot],
        tiling: app.uvTiling,
        offset: app.uvOffset,
      });
      this.pendingKeys.add(key);
      maps[slot] = key;
    }
  }

  /** Releases textures the material pass in progress no longer reads. */
  private commitTextures(): void {
    for (const key of this.textureKeys) {
      if (!this.pendingKeys.has(key)) this.deps.host.textures.release(key);
    }
    this.textureKeys = this.pendingKeys;
    this.pendingKeys = new Set();
  }
}

/** UV coordinates of every panel mesh, concatenated in merged order. */
function mergedUVs(panelMeshes: ReadonlyMap<string, PanelMesh>, particleCount: number): Float32Array {
  const uvs = new Float32Array(particleCount * 2);
  let offset = 0;
  for (const mesh of panelMeshes.values()) {
    for (let i = 0; i < mesh.vertexCount * 2; i++) uvs[offset + i] = mesh.uvs[i]!;
    offset += mesh.vertexCount * 2;
  }
  return uvs;
}

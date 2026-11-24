import type { FabricAppearance, Project } from '@/model/types';
import type { PanelMesh } from '@/pattern/panel';
import type { PresenterHost } from '@/runtime/world/presenters/host';
import type { ClothSimInput } from '@/sim/common';

import { computeVertexNormals } from '@/base/geom';
import { clothMaterialSlotKey, clothMaterialSlotPlan } from '@/model';
import {
  CHANNEL_ALL, type EntityId, type MaterialDesc, type MaterialId, type MeshId,
} from '@/render/world';
import { FALLBACK_APPEARANCE } from '@/runtime/engine/clothConstants';
import { printPaint } from '@/runtime/world/presenters/printTextures';

const MAP_COLOR_SPACE = {
  albedo: 'srgb', normal: 'linear', roughness: 'linear', metallic: 'linear',
} as const;

interface ClothGroupRange {
  start: number;
  count: number;
  slot: number;
  panelId: string;
}

export interface ClothPresenterDeps {
  host: PresenterHost;
  input: () => ClothSimInput | null;
  panelMeshes: () => ReadonlyMap<string, PanelMesh>;
  refreshPhysics: (project: Project) => void;
}

export class ClothPresenter {
  private meshId: MeshId | null = null;
  private entity: EntityId | null = null;
  private materials: MaterialId[] = [];
  private slotKeys: string[] = [];
  private groups: ClothGroupRange[] = [];
  private textureKeys = new Set<string>();
  private pendingKeys = new Set<string>();
  private field: Float32Array | null = null;
  private positions: Float32Array | null = null;
  private normals: Float32Array | null = null;
  private uvs: Float32Array | null = null;

  constructor(private readonly deps: ClothPresenterDeps) {}

  get entityId(): EntityId | null {
    return this.entity;
  }

  get mesh(): MeshId | null {
    return this.meshId;
  }

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

  updateFromSim(positions: Float32Array, normals: Float32Array): void {
    if (this.meshId === null) return;
    this.positions = positions;
    this.normals = normals;
    this.deps.host.writer.updateMesh(this.meshId, { streams: { position: positions, normal: normals } });
  }

  resetTo(positions: Float32Array): void {
    const input = this.deps.input();
    if (this.meshId === null || !input) return;
    this.positions = positions;
    this.normals = computeVertexNormals(positions, input.indices);
    this.deps.host.writer.updateMesh(this.meshId, {
      streams: { position: positions, normal: this.normals },
    });
  }

  setField(field: Float32Array): void {
    if (this.meshId === null || !this.field) return;
    this.field.set(field.subarray(0, this.field.length));
    this.deps.host.writer.updateMesh(this.meshId, { streams: { field: this.field } });
  }

  clearField(): void {
    if (this.meshId === null || !this.field) return;
    this.field.fill(0);
    this.deps.host.writer.updateMesh(this.meshId, { streams: { field: this.field } });
  }

  surfaceData(): { positions: Float32Array; normals: Float32Array; uv: Float32Array } | null {
    if (!this.positions || !this.normals || !this.uvs) return null;
    return { positions: this.positions, normals: this.normals, uv: this.uvs };
  }

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

  private panelAtTriangle(triangle: number): string | null {
    const offset = triangle * 3;
    for (const group of this.groups) {
      if (offset >= group.start && offset < group.start + group.count) return group.panelId;
    }

    return null;
  }

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

    this.bindMaps(app, index, maps, printed);
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

  private bindMaps(
    app: FabricAppearance, index: number, maps: NonNullable<MaterialDesc['maps']>, skipAlbedo = false,
  ): void {
    for (const slot of ['albedo', 'normal', 'roughness', 'metallic'] as const) {
      if (slot === 'albedo' && skipAlbedo) continue;
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

  private commitTextures(): void {
    for (const key of this.textureKeys) {
      if (!this.pendingKeys.has(key)) this.deps.host.textures.release(key);
    }

    this.textureKeys = this.pendingKeys;
    this.pendingKeys = new Set();
  }
}

function mergedUVs(panelMeshes: ReadonlyMap<string, PanelMesh>, particleCount: number): Float32Array {
  const uvs = new Float32Array(particleCount * 2);
  let offset = 0;
  for (const mesh of panelMeshes.values()) {
    for (let i = 0; i < mesh.vertexCount * 2; i++) uvs[offset + i] = mesh.uvs[i]!;
    offset += mesh.vertexCount * 2;
  }

  return uvs;
}

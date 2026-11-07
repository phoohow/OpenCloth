import * as THREE from 'three/webgpu';
import type { Project } from '@/model/types';
import type { PanelMesh } from '@/pattern/panel';
import type { ClothSimInput } from '@/sim';
import {
  applyFabricAppearance, createCompositeTexture, createFabricMaterial, panelPrintFrame, printPlacement,
  type CompositeTextureHandle, type PrintPlacement,
} from '@/render';
import { ClothSurface } from '@/render';
import {
  clothMaterialSlotKey, clothMaterialSlotPlan, fabricForPanel, panelPrints,
} from '@/model';
import { FALLBACK_APPEARANCE } from '@/runtime/clothConstants';
import type { SceneSlot } from '@/render';

/** Index range, material slot and owning panel of one cloth geometry group. */
interface ClothGroupRange {
  start: number;
  count: number;
  slot: number;
  panelId: string;
}

/** What the cloth view reads from the rest of the engine. */
export interface ClothViewDeps {
  slot: SceneSlot;
  /** Merged input the drawn mesh mirrors; null before a build. */
  input: () => ClothSimInput | null;
  /** Panel meshes in merged order, the source of the merged UVs. */
  panelMeshes: () => ReadonlyMap<string, PanelMesh>;
  /** Re-reads material physics into the solver. */
  refreshPhysics: (project: Project) => void;
}

/**
 * The drawn garment: material slots, panel visibility groups and the composed print textures.
 * The geometry and its two layers live in ClothSurface, shared with the analysis channels.
 */
export class ClothView {
  private surface: ClothSurface | null = null;
  /** Identity of each material slot, in slot order. */
  private slots: (string | null)[] = [];
  /** One geometry group per panel, in merged order. */
  private groups: ClothGroupRange[] = [];
  private printTextures = new Map<string, CompositeTextureHandle>();

  constructor(private readonly deps: ClothViewDeps) { }

  /** Shared cloth geometry and its fabric and heatmap layers. */
  get clothSurface(): ClothSurface | null {
    return this.surface;
  }

  /** The merged fabric mesh, or null before a build. */
  get mesh(): THREE.Mesh | null {
    return this.surface?.fabric ?? null;
  }

  /** Geometry of the merged mesh, the shared source of overlays and picking. */
  get geometry(): THREE.BufferGeometry | null {
    return this.surface?.geometry ?? null;
  }

  /** Builds the shared cloth surface and its material slots. */
  create(project: Project): void {
    const input = this.deps.input();
    if (!input) return;
    this.clearPrintTextures();
    this.surface = new ClothSurface(
      this.deps.slot,
      input.positions,
      input.indices,
      mergedUVs(this.deps.panelMeshes(), input.particleCount),
      createFabricMaterial(FALLBACK_APPEARANCE),
    );
    this.bindMaterials(project);
  }

  /** Takes both cloth layers out of the scene and frees their buffers. */
  remove(): void {
    this.clearPrintTextures();
    this.surface?.dispose();
    this.surface = null;
  }

  /** Drops every GPU resource and slot identity. */
  clear(): void {
    this.remove();
    this.slots = [];
    this.groups = [];
  }

  /** Pushes simulated positions and normals into the render mesh. */
  updateFromSim(positions: Float32Array, normals: Float32Array): void {
    this.surface?.updateFromSim(positions, normals);
    this.deps.slot.markRevision('deform');
  }

  /** Restores the mesh to a static layout. */
  resetTo(positions: Float32Array): void {
    this.surface?.resetTo(positions);
  }

  /** Shows or hides the whole garment, leaving the simulation running. */
  setVisible(visible: boolean): void {
    if (!this.surface) return;
    this.surface.fabric.visible = visible;
    this.deps.slot.markRevision('visibility');
  }

  /** Re-applies the material records to the built mesh; never rebuilds geometry. */
  applyFabrics(project: Project): void {
    const surface = this.surface;
    if (!surface) return;

    const plan = clothMaterialSlotPlan(project, this.panelIds());
    const materials = surface.boundMaterials;
    const keys = plan.slots.map(clothMaterialSlotKey);
    const sameSlots = keys.length === this.slots.length
      && keys.every((key, i) => key === this.slots[i]);
    if (sameSlots && materials.length === plan.slots.length) {
      plan.slots.forEach((slot, i) => {
        const material = materials[i];
        if (!(material instanceof THREE.MeshPhysicalMaterial)) return;
        const app = slot.fabric?.appearance ?? FALLBACK_APPEARANCE;
        const composite = slot.panelId ? this.printTextures.get(slot.panelId) : null;
        if (composite) {
          composite.redraw(app, this.printPlacements(project, slot.panelId!));
          applyFabricAppearance(material, app, composite.texture);
          return;
        }
        applyFabricAppearance(material, app);
      });
    } else {
      this.bindMaterials(project);
    }

    this.deps.slot.markRevision('material');
    this.deps.refreshPhysics(project);
  }

  /** Draws only the panels marked visible; hidden panels keep simulating. */
  applyPanelVisibility(project: Project): void {
    if (!this.surface || this.groups.length === 0) return;
    this.surface.addGroups(this.groups
      .filter(group => project.pattern.panels[group.panelId]?.visible !== false)
      .map(group => ({ start: group.start, count: group.count, slot: group.slot })));
  }

  /** Panel ids in merged-cloth order. */
  private panelIds(): string[] {
    return this.deps.input()?.panels.map(panel => panel.panelId) ?? [];
  }

  /**
   * Binds one material per slot, with a geometry group per panel. A printed panel gets its own
   * slot so its composed texture can be drawn into a material of its own.
   */
  private bindMaterials(project: Project): void {
    const surface = this.surface;
    const input = this.deps.input();
    if (!surface || !input) return;
    const plan = clothMaterialSlotPlan(project, this.panelIds());
    const materials = plan.slots.map(slot => {
      const app = slot.fabric?.appearance ?? FALLBACK_APPEARANCE;
      const composite = slot.panelId ? this.printTexture(project, slot.panelId) : null;
      return createFabricMaterial(app, composite?.texture ?? null);
    });
    this.prunePrintTextures(plan.slots);

    let indexStart = 0;
    const groups: ClothGroupRange[] = input.panels.map((panel, i) => {
      const count = panel.mesh.indices.length;
      const group = { start: indexStart, count, slot: plan.slotForPanel[i], panelId: panel.panelId };
      indexStart += count;
      return group;
    });

    surface.setMaterials(materials);
    this.groups = groups;
    surface.addGroups(groups);
    this.slots = plan.slots.map(clothMaterialSlotKey);
  }

  /** UV placements of a panel's visible prints; empty while its mesh is missing. */
  private printPlacements(project: Project, panelId: string): PrintPlacement[] {
    const mesh = this.deps.panelMeshes().get(panelId);
    if (!mesh) return [];
    const frame = panelPrintFrame(project.pattern, panelId, mesh.positions2D);
    if (!frame) return [];
    return panelPrints(project, panelId).map(print => printPlacement(print, frame));
  }

  /** Composed texture of one printed panel, created on first use. */
  private printTexture(project: Project, panelId: string): CompositeTextureHandle | null {
    const existing = this.printTextures.get(panelId);
    if (existing) return existing;
    const mesh = this.deps.panelMeshes().get(panelId);
    const frame = mesh ? panelPrintFrame(project.pattern, panelId, mesh.positions2D) : null;
    if (!frame) return null;
    const handle = createCompositeTexture(
      fabricForPanel(project, panelId)?.appearance ?? FALLBACK_APPEARANCE,
      this.printPlacements(project, panelId),
      { x: frame.max.x - frame.min.x, y: frame.max.y - frame.min.y },
    );
    this.printTextures.set(panelId, handle);
    return handle;
  }

  /** Drops composed textures of panels that no longer print. */
  private prunePrintTextures(slots: readonly { panelId: string | null }[]): void {
    const printed = new Set(slots.flatMap(slot => slot.panelId ? [slot.panelId] : []));
    for (const [panelId, handle] of this.printTextures) {
      if (printed.has(panelId)) continue;
      handle.dispose();
      this.printTextures.delete(panelId);
    }
  }

  /** Frees every composed print texture. */
  private clearPrintTextures(): void {
    for (const handle of this.printTextures.values()) handle.dispose();
    this.printTextures.clear();
  }
}

/** UV coordinates of every panel mesh, concatenated in merged order. */
function mergedUVs(panelMeshes: ReadonlyMap<string, PanelMesh>, particleCount: number): Float32Array {
  const uvs = new Float32Array(particleCount * 2);
  let offset = 0;
  for (const mesh of panelMeshes.values()) {
    for (let i = 0; i < mesh.vertexCount * 2; i++) uvs[offset + i] = mesh.uvs[i];
    offset += mesh.vertexCount * 2;
  }
  return uvs;
}

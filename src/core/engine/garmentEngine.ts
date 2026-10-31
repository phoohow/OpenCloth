import * as THREE from 'three/webgpu';
import type { Project, SimulationConfig, FabricPhysics, ObjectTransform, RenderMode, Vec3, CameraProjection, ReferenceObjectRef, EditPreviewTier } from '../model/types';
import { buildPanelMesh, type PanelMesh } from '../../pattern/panel/panelBuilder';
import { DEFAULT_MESH_RESOLUTION_CM } from '../model/defaults';
import { fabricForPanel, fabricSlotPlan } from '../model/fabric';
import { ClothSimulator, type ClothSimInput } from '../../sim/clothSimulator';
import type { ParticlePickHit } from '../../sim/picking';
import { ClothMeshManager, applyFabricAppearance, createMaterialForMode } from '../../render/material/fabricMaterial';
import type { RendererContext } from '../../render/renderer/rendererContext';
import {
  isOrthographic, setCameraProjection, syncOrthoFrustum, viewportAspect, rendererDevice,
} from '../../render/renderer/rendererContext';
import { AvatarStage } from './avatarStage';
import { BodyLandmarkCache } from './initialPose';
import { ClothPicker, type CameraPreset } from './clothPicker';
import { MergedCloth } from './mergedCloth';
import { EnvironmentStage } from './environmentStage';
import { PinMarkers } from './pinMarkers';
import { ReferenceStage, type ReferenceObject } from './referenceStage';
import { SeamThreads } from './seamThreads';
import { SelectionOverlay } from './selectionOverlay';
import { DressingController } from './dressingController';
import { appearanceSignature, avatarBodySignature, clothLayoutFingerprint, constraintSignature, geometrySignatures, physicsSignature, visibilitySignature, type ClothGroupRange } from './clothSignatures';
import { timeAsync } from './engineTiming';
import { FALLBACK_APPEARANCE, FALLBACK_PHYSICS, editPreviewResolutionCm } from './clothConstants';
import { computeFitField, fitStats, type FitStats } from '../../render/analysis/fit';
import { FitOverlay } from '../../render/analysis/fitOverlay';
import { computeVertexStrain, strainStats, type StrainStats } from '../../render/analysis/strain';

export type { CameraPreset, ReferenceObject };
export { applyObjectTransform } from './objectTransforms';
export { DRESS_FRAMES, DRESS_GLIDE, RELAX_FRAMES, SEW_FRAMES } from './dressingStages';

/** Key the merged cloth mesh is stored under. */
const MERGED_MESH_KEY = '__merged__';

/** Default screen tolerance for particle picking, as a fraction of viewport height. */
const DEFAULT_PICK_RADIUS_FACTOR = 0.03;

/** Live camera placement of the viewport; not part of the project data. */
export interface CameraState {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees; meaningful while the projection is perspective. */
  fovDeg: number;
  projection: CameraProjection;
  /** World height the orthographic frustum spans in meters; meaningful while orthographic. */
  viewHeightMeters: number;
}

/** Orchestrates the garment pipeline: pattern → mesh → draping placement → GPU simulation → render meshes. */
export class GarmentEngine {
  private cloth = new MergedCloth();
  private landmarks = new BodyLandmarkCache();
  private avatar = new AvatarStage();
  private references = new ReferenceStage();
  private environment: EnvironmentStage;
  private picker: ClothPicker;
  private pinMarkers = new PinMarkers();
  private seamThreads = new SeamThreads();

  /** Simulation input covering every panel, rebuilt by `mergePanelMeshes`. */
  private mergedInput: ClothSimInput | null = null;
  /** Initial (unsewn, flat) merged particle positions in meters. */
  private mergedPositions: Float32Array = new Float32Array(0);
  /** Wrapped positions with every seam pair collapsed onto one point; the dressing glide aims here. */
  private dressPositions: Float32Array = new Float32Array(0);

  private simulator: ClothSimulator | null = null;
  private simReady = false;
  private stepping = false;
  /** One non-finite warning per cloth build. */
  private nonFiniteReported = false;
  /** Most recent finite readback; the dressing glide starts from what is actually drawn. */
  private lastGoodPositions: Float32Array = new Float32Array(0);
  /** Staged dressing animation state; null once the garment is unsewn or already dressed. */
  private dressing!: DressingController;

  /** Panel meshes built from the pattern, keyed by panel id in merged order. */
  private panelMeshes: Map<string, PanelMesh> = new Map();
  private clothMeshes: Map<string, ClothMeshManager> = new Map();
  /** Heatmap mesh drawn in place of the fabric while the fit check is on. */
  private fitOverlay: FitOverlay | null = null;
  private fitVisible = false;
  /** Frames between two clearance passes; the CPU check is heavier than one solver step. */
  private fitCountdown = 0;
  /** Strain heatmap toggle, sharing the one heatmap overlay with the fit check. */
  private strainVisible = false;
  private strainCountdown = 0;
  /** Flat-pattern rest positions of every merged particle, the strain denominator. */
  private mergedRestPositions: Float32Array = new Float32Array(0);
  /** Material id behind each cloth geometry group slot, in first-use order. */
  private clothSlots: (string | null)[] = [];
  /** Index range, material slot and owning panel of every cloth geometry group. */
  private clothGroupRanges: ClothGroupRange[] = [];
  /** Signature of the panel visibility applied to the cloth groups. */
  private appliedVisibility = '';
  /** Per-panel geometry signatures from the last full or incremental build. */
  private appliedGeometry: Map<string, string> = new Map();
  /** Body signature of the avatar currently built in the scene. */
  private appliedAvatar = '';
  /** Fingerprint of the merged layout the live simulator was set up for. */
  private simulatorLayout = '';
  /** Body signature the live simulator's collision capsules were built for. */
  private simulatorAvatar = '';
  /** Render mode the cloth materials were last built for. */
  private clothMaterialMode: RenderMode | null = null;
  /** Signature of the appearance values currently bound to the cloth materials. */
  private appliedAppearance = '';
  /** Signature of the material physics currently loaded in the solver. */
  private appliedPhysics = '';
  /** Signature of the seam, dart-closing and fold-crease constraint sets currently loaded in the solver. */
  private appliedConstraints = '';
  /** Seam pair count the thread overlay was last built for; -1 when it is not attached. */
  private threadedPairCount = -1;

  /** Translucent clone of the selected panels' triangles. */
  private selection = new SelectionOverlay();
  private avatarHighlighted = false;

  constructor(private rendererCtx: RendererContext) {
    this.environment = new EnvironmentStage(rendererCtx);
    this.dressing = new DressingController({
      simulator: () => this.simulator,
      simReady: () => this.simReady,
      ensureSimulator: project => this.initSimulator(project),
      step: (config, fabric) => this.stepSimulation(config, fabric),
      resetPositions: () => this.resetSimulation(),
      currentPositions: () => this.lastGoodPositions,
      dressTargets: () => this.dressPositions,
    });
    this.picker = new ClothPicker(rendererCtx, {
      mesh: () => this.clothMeshes.get(MERGED_MESH_KEY)?.mesh ?? null,
      trianglePanelIds: () => this.cloth.trianglePanelIds,
      triangleParticles: triangle => mergedTriangleParticles(this.mergedInput, triangle),
      particlePositions: () => this.clothParticlePositions(),
      panelIds: () => this.clothPanelIds(),
      pickNearestParticle: (origin, direction, radius) =>
        this.simulator?.pickNearestParticle(origin, direction, radius) ?? null,
      pickParticleAtPoint: (point, radius, panelSlot) =>
        this.simulator?.pickNearestAtPoint(point, radius, panelSlot) ?? null,
      frameObjects: () => this.frameObjects(),
    });
  }

  /** Positions the solver last reported on the CPU, falling back to the initial layout. */
  private clothParticlePositions(): Float32Array | null {
    const input = this.mergedInput;
    if (!input) return null;
    const cached = this.simulator?.getReadbackPositions();
    return cached?.length === input.particleCount * 3 ? cached : this.mergedPositions;
  }

  /** Builds or rebuilds the cloth meshes from the project pattern; dev builds log the cost. */
  async buildFromProject(project: Project): Promise<void> {
    await timeAsync(`buildFromProject (${Object.keys(project.pattern.panels).length} panels)`, () => this.buildCloth(project));
    this.appliedGeometry = geometrySignatures(project);
    this.appliedAvatar = avatarBodySignature(project.avatar);
  }

  /**
   * Rebuilds only the panels whose geometry signature changed. Unchanged panels keep
   * their mesh and, when particle layout is stable, their live simulated positions.
   */
  async syncFromProject(project: Project): Promise<void> {
    // A measurement or pose edit changes the body, its capsules and the drape wrap.
    if (avatarBodySignature(project.avatar) !== this.appliedAvatar) {
      await this.buildFromProject(project);
      return;
    }
    const next = geometrySignatures(project);
    const previous = this.appliedGeometry;
    if (previous.size === 0) {
      await this.buildFromProject(project);
      return;
    }

    const changed = [...next.keys()].filter(id => previous.get(id) !== next.get(id));
    const removed = [...previous.keys()].filter(id => !next.has(id));
    if (changed.length === 0 && removed.length === 0) {
      // Only drawing flags or constraint data moved; keep meshes, refresh constraints and threads.
      this.refreshConstraintSets(project);
      this.applySeamStitchVisibility(project);
      return;
    }

    for (const panelId of removed) this.panelMeshes.delete(panelId);
    const layoutStable = removed.length === 0
      && [...next.keys()].join('|') === [...previous.keys()].join('|');
    let statePreserved = layoutStable;
    for (const panelId of changed) {
      const mesh = buildPanelMesh(project.pattern, panelId);
      const old = this.panelMeshes.get(panelId);
      if (mesh) {
        if (old && mesh.vertexCount !== old.vertexCount) statePreserved = false;
        this.panelMeshes.set(panelId, mesh);
      } else {
        this.panelMeshes.delete(panelId);
        statePreserved = false;
      }
    }

    const carried = statePreserved && this.lastGoodPositions.length === this.mergedPositions.length
      ? this.lastGoodPositions
      : null;
    const before = this.mergedInput;
    this.mergedInput = this.mergePanelMeshes(project);
    if (!this.mergedInput) return;
    let rebased = false;
    if (carried && before) {
      this.carryParticleRanges(before, this.mergedInput, carried);
      if (clothLayoutFingerprint(before, this.cloth.seamPairs.length) === clothLayoutFingerprint(this.mergedInput, this.cloth.seamPairs.length)
        && this.simulator && this.simReady) {
        this.simulator.rebaseGeometry(this.mergedInput, this.mergedInput.positions, carried);
        this.mergedPositions = this.mergedInput.positions.slice();
        rebased = true;
      }
    }
    this.removeRenderMesh();
    this.createRenderMesh(project);
    if (rebased) {
      this.simulatorLayout = clothLayoutFingerprint(this.mergedInput, this.cloth.seamPairs.length);
      this.installConstraintSets();
    } else {
      this.simulatorLayout = '';
    }
    this.appliedGeometry = next;
  }

  /**
   * Rebuilds the cloth from an in-flight 2D edit and redraws it at the preview tier's mesh
   * density, or redraws the committed pattern when the edit ends. The applied geometry signature
   * and the simulator layout keep describing the committed pattern, so the edit's own commit still
   * rebuilds; the committed panel meshes are only borrowed for the merge and restored afterwards.
   */
  previewEditPattern(project: Project, tier: EditPreviewTier): void {
    const drawn = this.mergedInput;
    if (tier === 'off' || !drawn) return;

    const committed = this.appliedGeometry;
    const previewMeshes = new Map<string, PanelMesh>();
    let everyMeshLent = true;
    for (const [panelId, signature] of geometrySignatures(project)) {
      const lent = tier === 'full' ? this.panelMeshes.get(panelId) : undefined;
      if (lent && committed.get(panelId) === signature) {
        previewMeshes.set(panelId, lent);
        continue;
      }
      everyMeshLent = false;
      const panelResolution = project.pattern.panels[panelId]?.meshResolutionCm ?? DEFAULT_MESH_RESOLUTION_CM;
      const mesh = buildPanelMesh(project.pattern, panelId, editPreviewResolutionCm(tier, panelResolution));
      if (mesh) previewMeshes.set(panelId, mesh);
    }

    const live = this.lastGoodPositions;
    const committedMeshes = this.panelMeshes;
    this.panelMeshes = previewMeshes;
    try {
      const input = this.mergePanelMeshes(project);
      if (!input || input.particleCount === 0) return;
      // The solver's live positions only fit a layout with the same particle count.
      const fits = live.length === input.particleCount * 3;
      if (fits && everyMeshLent) {
        // Every panel lent its committed mesh, so this is the committed layout again.
        input.positions.set(live);
        this.mergedPositions = live.slice();
      } else if (fits && input.particleCount === drawn.particleCount) {
        this.carryParticleRanges(drawn, input, live);
        if (clothLayoutFingerprint(drawn, this.cloth.seamPairs.length)
          === clothLayoutFingerprint(input, this.cloth.seamPairs.length)
          && this.simulator && this.simReady) {
          this.simulator.rebaseGeometry(input, input.positions, live);
        }
      }
      this.removeRenderMesh();
      this.createRenderMesh(project);
    } finally {
      this.panelMeshes = committedMeshes;
    }
  }

  /** Copies live positions of unchanged panel ranges into the freshly merged layout. */
  private carryParticleRanges(
    before: ClothSimInput, after: ClothSimInput, carried: Float32Array,
  ): void {
    const beforeRanges = new Map(before.panels.map(p => [p.panelId, p]));
    let copied = 0;
    for (const panel of after.panels) {
      const old = beforeRanges.get(panel.panelId);
      if (!old || old.vertexOffset !== panel.vertexOffset) continue;
      const count = old.mesh.vertexCount;
      if (count !== panel.mesh.vertexCount) continue;
      for (let i = 0; i < count * 3; i++) {
        after.positions[panel.vertexOffset * 3 + i] = carried[old.vertexOffset * 3 + i];
      }
      copied += count;
    }
    if (copied > 0) this.mergedPositions = after.positions.slice();
  }

  private async buildCloth(project: Project): Promise<void> {
    const scene = this.rendererCtx.scene;
    this.clearCloth();
    this.nonFiniteReported = false;
    this.panelMeshes.clear();
    this.selection.clear(scene);
    this.pinMarkers.clear(scene);

    // The avatar and reference objects show even before a garment is draped.
    await this.buildAvatar(project);
    await this.references.ensure(project.scene.referenceObjects ?? [], scene);

    const panelIds = Object.keys(project.pattern.panels);
    if (panelIds.length === 0) return;

    // Global mesh density from the simulation settings overrides per-panel resolution.
    for (const panelId of panelIds) {
      const mesh = buildPanelMesh(project.pattern, panelId);
      if (mesh) this.panelMeshes.set(panelId, mesh);
    }

    this.mergedInput = this.mergePanelMeshes(project);
    if (!this.mergedInput || this.mergedInput.particleCount === 0) return;
    this.createRenderMesh(project);
    this.simulatorLayout = clothLayoutFingerprint(this.mergedInput);
  }

  /** Whether the live solver still matches the merged layout; false after an incremental sync. */
  needsSimulatorRebuild(): boolean {
    if (!this.mergedInput) return false;
    return this.simulatorAvatar !== this.appliedAvatar
      || this.simulatorLayout !== clothLayoutFingerprint(this.mergedInput, this.cloth.seamPairs.length);
  }

  /** Merges the panel meshes into a single simulation input. */
  private mergePanelMeshes(project: Project): ClothSimInput | null {
    const input = this.cloth.build(project, this.panelMeshes, this.landmarks);
    this.mergedInput = input;
    this.mergedPositions = this.cloth.positions;
    this.mergedRestPositions = input ? mergedRestPositions(input) : new Float32Array(0);
    this.dressPositions = this.cloth.dressPositions;
    this.appliedConstraints = input ? constraintSignature(project) : '';
    return input;
  }

  /**
   * Re-reads the panel fold lines and the darts whose legs are being closed onto the live solver.
   * Panel meshes, particle layout and pins stay untouched; when the meshes no longer match the
   * merged layout the input is rebuilt and the viewport re-inits the simulator.
   */
  refreshConstraintSets(project: Project): void {
    if (!this.mergedInput) return;
    const signature = constraintSignature(project);
    if (signature === this.appliedConstraints) return;
    if (!this.cloth.refreshConstraintSets(project, this.panelMeshes)) {
      this.mergePanelMeshes(project);
      this.simulatorLayout = '';
      return;
    }
    this.appliedConstraints = signature;
    this.installConstraintSets();
    this.applySeamStitchVisibility(project);
  }

  /** Installs the merged input's seam and fold-crease constraint groups into the running solver. */
  private installConstraintSets(): void {
    const input = this.mergedInput;
    if (!input || !this.simulator || !this.simReady) return;
    this.simulator.setSeamConstraints(input.seamConstraints);
    this.simulator.setCreaseEdges(input.panels.map(panel => panel.creaseEdges ?? []));
    this.simulatorLayout = clothLayoutFingerprint(input, this.cloth.seamPairs.length);
  }

  /** Replaces the scene body and re-applies its display, transform and highlight. */
  private async buildAvatar(project: Project): Promise<void> {
    await this.avatar.build(project.avatar, this.rendererCtx.scene);
    this.avatar.applyDisplay(project.avatar.display);
    this.avatar.place(project.avatar.transform);
    this.avatar.highlight(this.avatarHighlighted);
  }

  /** Builds the merged cloth render mesh and its seam threads. */
  private createRenderMesh(project: Project): void {
    const input = this.mergedInput;
    if (!input) return;
    const mode = project.scene.render.mode;

    const manager = new ClothMeshManager(
      input.positions,
      input.indices,
      mergedUVs(this.panelMeshes, input.particleCount),
      createMaterialForMode(FALLBACK_APPEARANCE, mode),
    );
    this.clothMeshes.set(MERGED_MESH_KEY, manager);
    this.bindClothMaterials(project, mode);
    this.rendererCtx.scene.add(manager.mesh);
    this.fitOverlay = new FitOverlay(manager.geometry);
    this.fitOverlay.setSlotCount(this.clothSlots.length);
    this.rendererCtx.scene.add(this.fitOverlay.mesh);
    this.updateHeatmapVisibility();
    this.fitCountdown = 0;
    this.strainCountdown = 0;
    this.threadedPairCount = -1;
    this.applySeamStitchVisibility(project);
  }

  /** Takes the cloth render mesh the scene shows right now out of it and frees its buffers. */
  private removeRenderMesh(): void {
    if (this.fitOverlay) {
      this.rendererCtx.scene.remove(this.fitOverlay.mesh);
      this.fitOverlay.dispose();
      this.fitOverlay = null;
    }
    const previous = this.clothMeshes.get(MERGED_MESH_KEY);
    if (!previous) return;
    this.rendererCtx.scene.remove(previous.mesh);
    previous.dispose();
    this.clothMeshes.delete(MERGED_MESH_KEY);
  }

  /** Panel ids in merged-cloth order. */
  private clothPanelIds(): string[] {
    return this.mergedInput?.panels.map(panel => panel.panelId) ?? [];
  }

  /** Binds one material per distinct material record, with a geometry group per panel. */
  private bindClothMaterials(project: Project, mode: RenderMode): void {
    const merged = this.clothMeshes.get(MERGED_MESH_KEY);
    if (!merged || !this.mergedInput) return;
    const plan = fabricSlotPlan(project, this.clothPanelIds());
    const materials = plan.fabrics.map(fabric => createMaterialForMode(fabric?.appearance ?? FALLBACK_APPEARANCE, mode));

    let indexStart = 0;
    const ranges: ClothGroupRange[] = this.mergedInput.panels.map((panel, i) => {
      const count = panel.mesh.indices.length;
      const range = { start: indexStart, count, slot: plan.slotForPanel[i], panelId: panel.panelId };
      indexStart += count;
      return range;
    });

    merged.setMaterials(materials);
    this.fitOverlay?.setSlotCount(materials.length);
    this.clothGroupRanges = ranges;
    merged.addGroups(ranges);
    this.clothSlots = plan.fabrics.map(fabric => fabric?.id ?? null);
    this.clothMaterialMode = mode;
    this.appliedAppearance = appearanceSignature(this.clothPanelIds(), project, mode);
    this.appliedVisibility = visibilitySignature(ranges, project);
  }

  /**
   * Draws only the panels marked visible: a hidden panel gets no geometry group, so its
   * index range is skipped while its particles keep simulating.
   */
  applyPanelVisibility(project: Project): void {
    if (this.clothGroupRanges.length === 0) return;
    const signature = visibilitySignature(this.clothGroupRanges, project);
    if (signature === this.appliedVisibility) return;
    const merged = this.clothMeshes.get(MERGED_MESH_KEY);
    if (!merged) return;
    this.appliedVisibility = signature;
    merged.addGroups(this.clothGroupRanges
      .filter(group => project.pattern.panels[group.panelId]?.visible !== false)
      .map(group => ({ start: group.start, count: group.count, slot: group.slot })));
  }

  /**
   * Switches the cloth between fabric materials and the body-clearance heatmap.
   * Returns the first summary when turning the overlay on.
   */
  setFitCheck(enabled: boolean, tightCm: number, looseCm: number): FitStats | null {
    if (enabled) this.strainVisible = false;
    this.fitVisible = enabled;
    this.updateHeatmapVisibility();
    this.fitCountdown = 0;
    return enabled ? this.refreshFit(tightCm, looseCm, true) : null;
  }

  /** Shows, hides or fades the shared heatmap overlay and the cloth mesh underneath. */
  private updateHeatmapVisibility(): void {
    const on = this.fitVisible || this.strainVisible;
    this.fitOverlay?.setVisible(on);
    const merged = this.clothMeshes.get(MERGED_MESH_KEY);
    if (merged) merged.mesh.visible = !on;
  }

  /**
   * Recomputes body clearance on the live positions every few frames while the overlay is on.
   * Returns null when the overlay is off or this call was skipped by the throttle.
   */
  refreshFit(tightCm: number, looseCm: number, force = false): FitStats | null {
    if (!this.fitVisible || !this.fitOverlay) return null;
    if (!force && this.fitCountdown > 0) {
      this.fitCountdown--;
      return null;
    }
    this.fitCountdown = 5;
    const sdf = this.avatar.sdf;
    const positions = this.lastGoodPositions.length === this.mergedPositions.length && this.mergedPositions.length > 0
      ? this.lastGoodPositions
      : this.mergedPositions;
    if (!sdf || positions.length === 0) return null;
    const field = computeFitField(positions, sdf, { thresholds: { tightCm, looseCm } });
    this.fitOverlay.update(field);
    return fitStats(field);
  }

  /**
   * Switches the cloth between fabric materials and the strain heatmap.
   * Returns the first summary when turning the overlay on.
   */
  setStrainCheck(enabled: boolean, min: number, max: number): StrainStats | null {
    if (enabled) this.fitVisible = false;
    this.strainVisible = enabled;
    this.updateHeatmapVisibility();
    this.strainCountdown = 0;
    return enabled ? this.refreshStrain(min, max, true) : null;
  }

  /** Recomputes per-vertex strain on the live positions every few frames while the overlay is on. */
  refreshStrain(min: number, max: number, force = false): StrainStats | null {
    if (!this.strainVisible || !this.fitOverlay || !this.mergedInput) return null;
    if (!force && this.strainCountdown > 0) {
      this.strainCountdown--;
      return null;
    }
    this.strainCountdown = 5;
    const rest = this.mergedRestPositions;
    const positions = this.lastGoodPositions.length === rest.length && rest.length > 0
      ? this.lastGoodPositions
      : rest;
    if (rest.length === 0 || positions.length === 0) return null;
    const strain = computeVertexStrain(rest, positions, this.mergedInput!.indices);
    const stats = strainStats(strain);
    this.fitOverlay.updateStrain(strain, min, max);
    return stats;
  }

  /**
   * Re-reads each seam record onto the thread overlay: color and viewport visibility, drawn
   * over the positions the cloth currently holds. The overlay is rebuilt whenever the pair set
   * changes size, which is what closing a dart does.
   */
  applySeamStitchVisibility(project: Project): void {
    const pairs = this.cloth.seamPairs;
    const positions = this.lastGoodPositions.length === this.mergedPositions.length && this.mergedPositions.length > 0
      ? this.lastGoodPositions
      : this.mergedPositions;
    if (pairs.length !== this.threadedPairCount) {
      this.threadedPairCount = pairs.length;
      this.seamThreads.attach(this.rendererCtx.scene, pairs, positions, project.pattern.seams);
      return;
    }
    this.seamThreads.setSeams(project.pattern.seams);
    this.seamThreads.update(pairs, positions);
  }

  /**
   * Re-applies the project's material records to the built cloth: appearance onto the
   * materials, physics into the solver. Neither path rebuilds geometry or restarts the simulation.
   */
  applyFabrics(project: Project, mode?: RenderMode): void {
    const merged = this.clothMeshes.get(MERGED_MESH_KEY);
    if (!merged || !this.mergedInput) return;
    const target = mode ?? this.clothMaterialMode ?? project.scene.render.mode;
    if (target !== this.clothMaterialMode) this.bindClothMaterials(project, target);

    const appearance = appearanceSignature(this.clothPanelIds(), project, target);
    if (appearance !== this.appliedAppearance) {
      this.appliedAppearance = appearance;
      const plan = fabricSlotPlan(project, this.clothPanelIds());
      const materials = Array.isArray(merged.mesh.material) ? merged.mesh.material : [merged.mesh.material];
      const sameSlots = plan.fabrics.length === this.clothSlots.length
        && plan.fabrics.every((fabric, i) => (fabric?.id ?? null) === this.clothSlots[i]);
      if (sameSlots && materials.length === plan.fabrics.length) {
        plan.fabrics.forEach((fabric, i) => {
          const material = materials[i];
          if (material instanceof THREE.MeshPhysicalMaterial) {
            applyFabricAppearance(material, fabric?.appearance ?? FALLBACK_APPEARANCE);
          }
        });
      } else {
        this.bindClothMaterials(project, target);
      }
    }

    const physics = physicsSignature(this.clothPanelIds(), project);
    if (physics !== this.appliedPhysics) {
      this.appliedPhysics = this.refreshClothPhysics(project) ? physics : '';
    }
  }

  /** Pushes each panel's material physics into the live solver; false when a rebuild is needed. */
  private refreshClothPhysics(project: Project): boolean {
    if (!this.simulator || !this.mergedInput) return true;
    const byPanel = this.mergedInput.panels.map(
      panel => fabricForPanel(project, panel.panelId)?.physics ?? FALLBACK_PHYSICS,
    );
    const positions = this.lastGoodPositions.length === this.mergedPositions.length
      ? this.lastGoodPositions
      : this.mergedPositions;
    if (!this.simulator.updateMaterialPhysics(byPanel, positions)) return false;
    this.mergedInput.panels.forEach((panel, i) => { panel.physics = byPanel[i]; });
    if (byPanel[0]) this.dressing.updatePhysics(byPanel[0]);
    return true;
  }

  /** Initializes the GPU cloth simulator on the viewport device, keeping the PINs the markers show. */
  async initSimulator(project: Project): Promise<void> {
    if (!this.mergedInput) return;
    await timeAsync(`initSimulator (${this.mergedInput.particleCount} particles)`, async () => {
      this.simulator?.destroy();
      const carried = this.carriedPinIndices(this.mergedInput!.particleCount);
      const input = carried.length > 0
        ? { ...this.mergedInput!, pinnedIndices: [...new Set([...(this.mergedInput!.pinnedIndices ?? []), ...carried])] }
        : this.mergedInput!;
      const simulator = new ClothSimulator(rendererDevice(this.rendererCtx));
      await simulator.setup(input, this.avatar.sdf, project.scene.simulation);
      this.simulator = simulator;
      this.simReady = true;
      this.appliedPhysics = physicsSignature(this.clothPanelIds(), project);
      this.simulatorLayout = clothLayoutFingerprint(this.mergedInput!, this.cloth.seamPairs.length);
      this.simulatorAvatar = this.appliedAvatar;
    });
  }

  /** Marked particles a simulator rebuild re-applies; markers past the particle count are dropped. */
  private carriedPinIndices(particleCount: number): number[] {
    const carried: number[] = [];
    for (const index of this.pinMarkers.list()) {
      if (index < particleCount) carried.push(index);
      else this.pinMarkers.remove(index, this.rendererCtx.scene);
    }
    return carried;
  }

  /** Runs one simulation step and writes the result to the render mesh. */
  async stepSimulation(config: SimulationConfig, fabric: FabricPhysics): Promise<void> {
    if (!this.simulator || !this.simReady || this.stepping) return;
    this.stepping = true;
    try {
      this.simulator.step(config, fabric);
      const { positions, normals } = await this.simulator.readback();
      const badParticle = firstNonFinite(positions);
      // A non-finite frame makes every triangle degenerate, so the last good frame stays drawn.
      if (badParticle >= 0) {
        if (!this.nonFiniteReported) {
          this.nonFiniteReported = true;
          console.warn(`Cloth simulation produced a non-finite position at particle ${badParticle}.`);
        }
        return;
      }
      // A preview mesh can hold fewer particles than the live solver; the readback would not fit it.
      if (positions.length !== this.mergedPositions.length) return;
      this.clothMeshes.get(MERGED_MESH_KEY)?.updateFromSim(positions, normals);
      if (this.lastGoodPositions.length !== positions.length) this.lastGoodPositions = new Float32Array(positions.length);
      this.lastGoodPositions.set(positions);
      this.seamThreads.update(this.cloth.seamPairs, positions);
      this.pinMarkers.sync(this.simulator.getReadbackPositions());
    } finally {
      this.stepping = false;
    }
  }

  /** Restores the simulation to its initial positions. */
  resetSimulation(): void {
    this.dressing.reset();
    if (!this.simulator || this.mergedPositions.length === 0) return;
    this.simulator.reset(this.mergedPositions);
    this.lastGoodPositions = this.mergedPositions.slice();
    // The render mesh follows the initial positions in the same frame.
    this.clothMeshes.get(MERGED_MESH_KEY)?.resetTo(this.mergedPositions);
    this.seamThreads.update(this.cloth.seamPairs, this.mergedPositions);
    this.pinMarkers.sync(this.mergedPositions);
  }

  /** True while a staged dressing animation is playing. */
  get isDraping(): boolean { return this.dressing.isDraping; }

  /** True when the seams are closed and the garment sits dressed on the body. */
  get isDressed(): boolean { return this.dressing.isDressed; }

  /** Starts the staged dressing animation from the unsewn layout; stepDressingFrame plays it. */
  async beginDrape(project: Project): Promise<boolean> {
    return this.dressing.beginDrape(project);
  }

  /** Plays one frame of the dressing animation; false once the garment has settled. */
  async stepDressingFrame(): Promise<boolean> {
    return this.dressing.stepDressingFrame();
  }

  /** Advances one animation frame: free physics once the garment is dressed, otherwise the dressing stages. */
  async stepFrame(project: Project): Promise<void> {
    return this.dressing.stepFrame(project);
  }

  /** Pin or unpin a cloth particle and update its marker. */
  async setPin(particleIndex: number, pinned: boolean): Promise<boolean> {
    if (!this.simulator) return false;
    if (!await this.simulator.setParticlePin(particleIndex, pinned)) return false;
    if (pinned) this.addPinMarker(particleIndex);
    else this.pinMarkers.remove(particleIndex, this.rendererCtx.scene);
    return true;
  }

  /** Currently pinned particle indices. */
  getPinnedParticles(): readonly number[] {
    return this.simulator?.getPinnedParticles() ?? [];
  }

  /** Particle indices carrying a PIN marker, that is, the points pinned by hand. */
  getPinMarkers(): readonly number[] {
    return this.pinMarkers.list();
  }

  /**
   * Releases every pinned particle in one solver pass and drops all markers, including the
   * automatic basting band, so clearing a large garment costs one GPU submit.
   */
  async clearPins(): Promise<boolean> {
    if (!this.simulator) return false;
    const indices = this.simulator.getPinnedParticles();
    const released = indices.length === 0 || await this.simulator.setParticlePins(indices, false);
    this.pinMarkers.clear(this.rendererCtx.scene);
    return released;
  }

  /** Nearest cloth particle to the ray through a screen point. */
  pickClothParticleAtScreen(ndcX: number, ndcY: number, radiusFactor = DEFAULT_PICK_RADIUS_FACTOR): ParticlePickHit | null {
    return this.picker.pickClothParticleAtScreen(ndcX, ndcY, radiusFactor);
  }

  /** Raycasts the cloth surface and returns the owning panel of the hit triangle. */
  pickPanelAtScreen(ndcX: number, ndcY: number): string | null {
    return this.picker.pickPanelAtScreen(ndcX, ndcY);
  }

  /** Highlights the listed panels; ids without cloth triangles are ignored. */
  setSelectedPanels(panelIds: string[]): void {
    const ids = panelIds.filter(id => (this.cloth.panelTriangles.get(id)?.length ?? 0) > 0);
    const merged = this.mergedInput ? this.clothMeshes.get(MERGED_MESH_KEY) : null;
    this.selection.apply(this.rendererCtx.scene, merged?.geometry ?? null, ids, this.cloth.overlayTriangles(ids));
  }

  /** Selected panel ids, in selection order. */
  getSelectedPanelIds(): string[] {
    return this.selection.getSelected();
  }

  /** Tints the avatar while it is the selected scene object. */
  setAvatarHighlighted(on: boolean): void {
    if (this.avatarHighlighted === on && (on ? this.avatar.hasOverlay : true)) return;
    this.avatarHighlighted = on;
    this.avatar.highlight(on);
  }

  /** Moves the camera to a named preset and focuses the orbit target on the garment. */
  setCameraPreset(preset: CameraPreset): void {
    this.picker.applyPreset(preset);
  }

  /** Refits the scene box along the current view direction, leaving the camera angle alone. */
  frameScene(): void {
    this.picker.frameScene();
  }

  /** Projection the viewport camera renders with. */
  getProjection(): CameraProjection {
    return this.rendererCtx.projection;
  }

  /** Swaps the viewport camera and refits the scene box along the current view direction. */
  setProjection(projection: CameraProjection): void {
    setCameraProjection(this.rendererCtx, projection);
    this.picker.frameScene();
  }

  getCameraState(): CameraState {
    const { camera, controls, orthoViewHeight } = this.rendererCtx;
    const ortho = isOrthographic(camera);
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      fovDeg: ortho ? this.rendererCtx.perspectiveCamera.fov : camera.fov,
      projection: this.rendererCtx.projection,
      viewHeightMeters: ortho ? orthoViewHeight / camera.zoom : orthoViewHeight,
    };
  }

  /** Moves the viewport camera, its orbit target and the active projection's frame size. */
  setCameraState(state: {
    position?: Vec3; target?: Vec3; fovDeg?: number; viewHeightMeters?: number;
  }): void {
    const ctx = this.rendererCtx;
    const { camera, controls } = ctx;
    if (state.position) camera.position.set(state.position.x, state.position.y, state.position.z);
    if (state.target) controls.target.set(state.target.x, state.target.y, state.target.z);
    if (state.fovDeg !== undefined) {
      ctx.perspectiveCamera.fov = state.fovDeg;
      ctx.perspectiveCamera.updateProjectionMatrix();
    }
    if (state.viewHeightMeters !== undefined) {
      // The wheel zoom folds into the base height so the slider always reads the live frame.
      ctx.orthoViewHeight = state.viewHeightMeters;
      ctx.orthographicCamera.zoom = 1;
      syncOrthoFrustum(ctx, viewportAspect(ctx));
    }
    controls.update();
  }

  /** Objects the camera framing counts: the body and every loaded reference model. */
  private frameObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    const avatar = this.avatar.object;
    if (avatar) objects.push(avatar);
    for (const reference of this.references.list()) objects.push(reference.group);
    return objects;
  }

  /** Places the avatar at its stored scene transform. */
  applyAvatarTransform(avatar: { transform?: ObjectTransform }): void {
    this.avatar.place(avatar.transform);
  }

  /** Shows, hides or fades the avatar body. */
  applyAvatarDisplay(display: 'visible' | 'hidden' | 'translucent'): void {
    this.avatar.applyDisplay(display);
  }

  /** Keeps the scene's reference meshes in sync with the project's reference list. */
  async reconcileReferences(project: Project): Promise<void> {
    await this.references.reconcile(project.scene.referenceObjects ?? [], this.rendererCtx.scene);
  }

  /** Stores a model file and adds it to the scene; the returned record belongs in the project list. */
  async importReferenceObject(file: File, id: string): Promise<ReferenceObjectRef> {
    return this.references.importFile(file, id, this.rendererCtx.scene);
  }

  /** Reference objects currently in the scene. */
  listReferenceObjects(): ReferenceObject[] {
    return this.references.list();
  }

  setReferenceVisible(id: string, visible: boolean): void {
    this.references.setVisible(id, visible);
  }

  setReferenceOpacity(id: string, opacity: number): void {
    this.references.setOpacity(id, opacity);
  }

  /** Places a reference object at its stored scene transform. */
  setReferenceTransform(id: string, transform: ObjectTransform): void {
    this.references.place(id, transform);
  }

  /** Applies the project's environment image as the scene backdrop and lighting source. */
  async applyEnvironment(project: Project): Promise<void> {
    await this.environment.apply(project.scene.lights);
  }

  /** Places a marker sphere on a pinned particle. */
  private addPinMarker(particleIndex: number): void {
    this.pinMarkers.add(particleIndex, this.clothParticlePositions(), this.rendererCtx.scene);
  }

  /** Removes and disposes the cloth meshes, seam threads, simulator and dressing run. */
  private clearCloth(): void {
    this.seamThreads.detach(this.rendererCtx.scene);
    this.dressing.reset();
    this.simulator?.destroy();
    this.simulator = null;
    this.lastGoodPositions = new Float32Array(0);
    this.mergedRestPositions = new Float32Array(0);
    this.fitVisible = false;
    this.strainVisible = false;
    for (const manager of this.clothMeshes.values()) {
      this.rendererCtx.scene.remove(manager.mesh);
      manager.dispose();
    }
    if (this.fitOverlay) {
      this.rendererCtx.scene.remove(this.fitOverlay.mesh);
      this.fitOverlay.dispose();
      this.fitOverlay = null;
    }
    this.clothMeshes.clear();
    this.clothSlots = [];
    this.clothMaterialMode = null;
    this.appliedAppearance = '';
    this.appliedPhysics = '';
    this.appliedConstraints = '';
    this.threadedPairCount = -1;
    this.simReady = false;
  }

  /** Takes the garment, body, references and environment out of the scene. */
  dispose(): void {
    const scene = this.rendererCtx.scene;
    this.selection.dispose(scene);
    this.avatar.highlight(false);
    this.clearCloth();
    this.pinMarkers.dispose(scene);
    this.references.clear(scene);
    this.avatar.detach(scene);
    this.environment.release();
  }
}

/** Particle indices of one merged cloth triangle; null when the triangle is out of range. */
function mergedTriangleParticles(input: ClothSimInput | null, triangle: number): readonly number[] | null {
  const indices = input?.indices;
  if (!indices || triangle < 0 || (triangle + 1) * 3 > indices.length) return null;
  const start = triangle * 3;
  return [indices[start], indices[start + 1], indices[start + 2]];
}

/** UV coordinates of every panel mesh, concatenated in merged order. */
function mergedUVs(panelMeshes: Map<string, PanelMesh>, particleCount: number): Float32Array {
  const uvs = new Float32Array(particleCount * 2);
  let offset = 0;
  for (const mesh of panelMeshes.values()) {
    for (let i = 0; i < mesh.vertexCount * 2; i++) uvs[offset + i] = mesh.uvs[i];
    offset += mesh.vertexCount * 2;
  }
  return uvs;
}

/** Flat-pattern rest positions of every panel, concatenated in merged order. */
function mergedRestPositions(input: ClothSimInput): Float32Array {
  const rest = new Float32Array(input.positions.length);
  for (const panel of input.panels) {
    rest.set(panel.restPositions, panel.vertexOffset * 3);
  }
  return rest;
}

/** Index of the first non-finite readback component, or -1 when every position is finite. */
function firstNonFinite(positions: Float32Array): number {
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) return Math.floor(i / 3);
  }
  return -1;
}

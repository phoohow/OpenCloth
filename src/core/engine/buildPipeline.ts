import type { EditPreviewTier, Project } from '../model/types';
import type { PanelMesh } from '../../pattern/panel/panelBuilder';
import { buildRegistry } from '../build/buildRegistry';
import { DEFAULT_MESH_RESOLUTION_CM } from '../model/defaults';
import type { ClothSimInput } from '../../sim/simTypes';
import { BodyLandmarkCache } from './initialPose';
import type { ClothAssembly } from './clothAssembly';
import { avatarBodySignature, geometrySignatures } from './buildSignatures';
import { editPreviewResolutionCm } from './clothConstants';

/**
 * What a build announces to the rest of the runtime. The pipeline never holds the solver or
 * the views: it states what changed and lets their owners react.
 */
export interface BuildHost {
  /** Removes the drawn cloth, threads and the solver before a full rebuild. */
  clear(): void;
  /** Builds the body and reference objects the merge reads. */
  prepare(project: Project): Promise<void>;
  /** Drops the drawn cloth so `repaint` can install the new one. */
  unrepaint(): void;
  /** Draws the merged cloth and the overlays that ride on it. */
  repaint(project: Project): void;
  /** Positions the solver last reported, or the initial layout before the first frame. */
  livePositions(): Float32Array;
  /** The merged layout no longer matches the one the solver was built for. */
  layoutStale(): void;
  /** Seam and fold constraints changed without moving any particle. */
  constraintsChanged(input: ClothSimInput, project: Project): void;
  /** A preview merged a layout the solver may follow without a rebuild. */
  previewMerged(drawn: ClothSimInput, input: ClothSimInput, live: Float32Array): void;
}

/**
 * Turns the pattern into one simulation input: panel meshes, merged arrays, seam pairs and the
 * merged constraints. It is the only place that knows a panel occupies a contiguous particle
 * slice, and the only place that decides whether the drawn garment still matches the pattern.
 */
export class BuildPipeline {
  /** Panel meshes of the committed pattern, keyed by panel id. */
  private meshes: Map<string, PanelMesh> = new Map();
  /** Merged simulation input, null while the pattern has no cloth. */
  private merged: ClothSimInput | null = null;
  /** Initial (unsewn, flat) merged particle positions in meters. */
  private mergedPositions: Float32Array = new Float32Array(0);
  /** Rest positions of every merged particle on the flat pattern, the strain denominator. */
  private flatRest: Float32Array = new Float32Array(0);
  /** Wrapped positions with every seam pair collapsed onto one point; the dressing glide aims here. */
  private dressTargets: Float32Array = new Float32Array(0);
  /** Per-panel geometry signatures from the last full or incremental build. */
  private appliedGeometry: Map<string, string> = new Map();
  /** Body signature the built meshes and merged positions were laid out on. */
  private appliedAvatar = '';
  private readonly landmarks = new BodyLandmarkCache();

  constructor(readonly assembly: ClothAssembly, private readonly host: BuildHost) { }

  /** Merged simulation input covering every panel. */
  get input(): ClothSimInput | null { return this.merged; }

  /** Panel meshes of the committed pattern. */
  get panelMeshes(): ReadonlyMap<string, PanelMesh> { return this.meshes; }

  /** Initial merged particle positions in meters. */
  get positions(): Float32Array { return this.mergedPositions; }

  /** Flat-pattern rest positions of every merged particle. */
  get restPositions(): Float32Array { return this.flatRest; }

  /** Wrapped positions the dressing glide aims for. */
  get dressingTargets(): Float32Array { return this.dressTargets; }

  /** Body signature the current build was laid out on. */
  get avatarSignature(): string { return this.appliedAvatar; }

  /** Forgets the merged input and every derived array; the meshes go with it. */
  reset(): void {
    this.merged = null;
    this.mergedPositions = new Float32Array(0);
    this.flatRest = new Float32Array(0);
    this.dressTargets = new Float32Array(0);
    this.meshes.clear();
  }

  /** Builds every panel from scratch, then merges them. */
  async build(project: Project): Promise<void> {
    this.host.clear();
    this.reset();
    // The avatar and reference objects show even before a garment is dressed.
    await this.host.prepare(project);

    // Global mesh density from the simulation settings overrides per-panel resolution.
    for (const panelId of Object.keys(project.pattern.panels)) {
      const mesh = buildRegistry.meshOf(project.pattern, panelId, undefined, project.scene.simulation);
      if (mesh) this.meshes.set(panelId, mesh);
    }

    // Merging with an empty pattern clears the stale seam pairs so no threads can be redrawn.
    if (!this.merge(project) || this.merged!.particleCount === 0) {
      this.appliedGeometry = geometrySignatures(project);
      this.appliedAvatar = avatarBodySignature(project.avatar);
      return;
    }
    this.host.repaint(project);
    this.appliedGeometry = geometrySignatures(project);
    this.appliedAvatar = avatarBodySignature(project.avatar);
  }

  /**
   * Rebuilds only the panels whose geometry signature changed. Unchanged panels keep their mesh
   * and, when the particle layout is stable, their live simulated positions.
   */
  async sync(project: Project): Promise<void> {
    // A measurement or pose edit changes the body, its capsules and the drape wrap.
    if (avatarBodySignature(project.avatar) !== this.appliedAvatar) {
      await this.build(project);
      return;
    }
    const next = geometrySignatures(project);
    const previous = this.appliedGeometry;
    // An empty pattern has no merged input, so a full build is the only way to drop the drawn cloth.
    if (previous.size === 0 || next.size === 0) {
      await this.build(project);
      return;
    }

    const changed = [...next.keys()].filter(id => previous.get(id) !== next.get(id));
    const removed = [...previous.keys()].filter(id => !next.has(id));
    if (changed.length === 0 && removed.length === 0) {
      // Only drawing flags or constraint data moved; keep meshes, refresh constraints and threads.
      this.refreshConstraints(project);
      return;
    }

    for (const panelId of removed) this.meshes.delete(panelId);
    for (const panelId of changed) {
      const mesh = buildRegistry.meshOf(project.pattern, panelId, undefined, project.scene.simulation);
      if (mesh) this.meshes.set(panelId, mesh);
      else this.meshes.delete(panelId);
    }

    this.merge(project);
    if (!this.merged) return;
    this.host.unrepaint();
    this.host.repaint(project);
    this.host.layoutStale();
    this.appliedGeometry = next;
  }

  /**
   * Rebuilds the cloth from an in-flight 2D edit and redraws it at the preview tier's mesh
   * density, or redraws the committed pattern when the edit ends. The applied geometry signature
   * and the solver layout keep describing the committed pattern, so the edit's own commit still
   * rebuilds; the committed panel meshes are only borrowed for the merge and restored afterwards.
   */
  preview(project: Project, tier: EditPreviewTier): void {
    const drawn = this.merged;
    if (tier === 'off' || !drawn) return;

    const committed = this.appliedGeometry;
    const previewMeshes = new Map<string, PanelMesh>();
    let everyMeshLent = true;
    for (const [panelId, signature] of geometrySignatures(project)) {
      const lent = tier === 'full' ? this.meshes.get(panelId) : undefined;
      if (lent && committed.get(panelId) === signature) {
        previewMeshes.set(panelId, lent);
        continue;
      }
      everyMeshLent = false;
      const panelResolution = project.pattern.panels[panelId]?.meshResolutionCm ?? DEFAULT_MESH_RESOLUTION_CM;
      const mesh = buildRegistry.meshOf(project.pattern, panelId, editPreviewResolutionCm(tier, panelResolution), project.scene.simulation);
      if (mesh) previewMeshes.set(panelId, mesh);
    }

    const live = this.host.livePositions();
    const committedMeshes = this.meshes;
    this.meshes = previewMeshes;
    try {
      const input = this.merge(project);
      if (!input || input.particleCount === 0) return;
      // The solver's live positions only fit a layout with the same particle count.
      const fits = live.length === input.particleCount * 3;
      if (fits && everyMeshLent) {
        // Every panel lent its committed mesh, so this is the committed layout again.
        input.positions.set(live);
        this.mergedPositions = live.slice();
      } else if (fits && input.particleCount === drawn.particleCount) {
        this.carryParticleRanges(drawn, input, live);
        this.host.previewMerged(drawn, input, live);
      }
      this.host.unrepaint();
      this.host.repaint(project);
    } finally {
      this.meshes = committedMeshes;
    }
  }

  /**
   * Re-reads the panel fold lines and the darts whose legs are being closed. Panel meshes,
   * particle layout and pins stay untouched; when the meshes no longer match the merged layout
   * the input is rebuilt and the solver is told its layout moved.
   */
  refreshConstraints(project: Project): void {
    if (!this.merged) return;
    if (!this.assembly.refreshConstraintSets(project, this.meshes)) {
      this.merge(project);
      this.host.layoutStale();
      return;
    }
    this.host.constraintsChanged(this.merged, project);
  }

  /** Merges the panel meshes into a single simulation input and refreshes the derived arrays. */
  private merge(project: Project): ClothSimInput | null {
    const input = this.assembly.build(project, this.meshes, this.landmarks);
    this.merged = input;
    this.mergedPositions = this.assembly.positions;
    this.flatRest = input ? mergedRestPositions(input) : new Float32Array(0);
    this.dressTargets = this.assembly.dressPositions;
    return input;
  }

  /** Copies live positions of unchanged panel ranges into the freshly merged layout. */
  private carryParticleRanges(before: ClothSimInput, after: ClothSimInput, carried: Float32Array): void {
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
}

/** Flat-pattern rest positions of every panel, concatenated in merged order. */
function mergedRestPositions(input: ClothSimInput): Float32Array {
  const rest = new Float32Array(input.positions.length);
  for (const panel of input.panels) {
    rest.set(panel.restPositions, panel.vertexOffset * 3);
  }
  return rest;
}

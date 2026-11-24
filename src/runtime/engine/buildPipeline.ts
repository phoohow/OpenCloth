import type { EditPreviewTier, Project } from '@/model/types';
import type { PanelMesh } from '@/pattern/panel';
import type { ClothAssembly } from '@/runtime/engine/clothAssembly';
import type { ClothSimInput } from '@/sim/common';

import { avatarBodySignature, geometrySignatures } from '@/runtime/engine/buildSignatures';
import { editPreviewResolutionCm } from '@/runtime/engine/clothConstants';
import { BodyLandmarkCache } from '@/runtime/engine/initialPose';
import { buildRegistry, meshResolutionOf } from '@/scene';

export interface BuildHost {
  clear(): void;
  prepare(project: Project): Promise<void>;
  unrepaint(): void;
  repaint(project: Project): void;
  livePositions(): Float32Array;
  layoutStale(): void;
  constraintsChanged(input: ClothSimInput, project: Project): void;
  previewMerged(drawn: ClothSimInput, input: ClothSimInput, live: Float32Array): void;
}

export class BuildPipeline {
  private meshes: Map<string, PanelMesh> = new Map();
  private merged: ClothSimInput | null = null;
  private mergedPositions: Float32Array = new Float32Array(0);
  private flatRest: Float32Array = new Float32Array(0);
  private dressTargets: Float32Array = new Float32Array(0);
  private appliedGeometry: Map<string, string> = new Map();
  private appliedAvatar = '';
  private readonly landmarks = new BodyLandmarkCache();

  constructor(readonly assembly: ClothAssembly, private readonly host: BuildHost) {}

  get input(): ClothSimInput | null { return this.merged; }

  get panelMeshes(): ReadonlyMap<string, PanelMesh> { return this.meshes; }

  get positions(): Float32Array { return this.mergedPositions; }

  get restPositions(): Float32Array { return this.flatRest; }

  get dressingTargets(): Float32Array { return this.dressTargets; }

  get avatarSignature(): string { return this.appliedAvatar; }

  reset(): void {
    this.merged = null;
    this.mergedPositions = new Float32Array(0);
    this.flatRest = new Float32Array(0);
    this.dressTargets = new Float32Array(0);
    this.meshes.clear();
  }

  async build(project: Project): Promise<void> {
    this.host.clear();
    this.reset();
    await this.host.prepare(project);

    for (const panelId of Object.keys(project.pattern.panels)) {
      const mesh = buildRegistry.meshOf(project.pattern, panelId, undefined, project.scene.simulation);
      if (mesh) this.meshes.set(panelId, mesh);
    }

    if (!this.merge(project) || this.merged!.particleCount === 0) {
      this.appliedGeometry = geometrySignatures(project);
      this.appliedAvatar = avatarBodySignature(project.avatar);
      return;
    }

    this.host.repaint(project);
    this.appliedGeometry = geometrySignatures(project);
    this.appliedAvatar = avatarBodySignature(project.avatar);
  }

  async sync(project: Project): Promise<void> {
    if (avatarBodySignature(project.avatar) !== this.appliedAvatar) {
      await this.build(project);
      return;
    }

    const next = geometrySignatures(project);
    const previous = this.appliedGeometry;
    if (previous.size === 0 || next.size === 0) {
      await this.build(project);
      return;
    }

    const changed = [...next.keys()].filter(id => previous.get(id) !== next.get(id));
    const removed = [...previous.keys()].filter(id => !next.has(id));
    if (changed.length === 0 && removed.length === 0) {
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
      const panelResolution = meshResolutionOf(project.scene.simulation);
      const mesh = buildRegistry.meshOf(project.pattern, panelId, editPreviewResolutionCm(tier, panelResolution), project.scene.simulation);
      if (mesh) previewMeshes.set(panelId, mesh);
    }

    const live = this.host.livePositions();
    const committedMeshes = this.meshes;
    this.meshes = previewMeshes;
    try {
      const input = this.merge(project);
      if (!input || input.particleCount === 0) return;
      const fits = live.length === input.particleCount * 3;
      if (fits && everyMeshLent) {
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

  refreshConstraints(project: Project): void {
    if (!this.merged) return;
    if (!this.assembly.refreshConstraintSets(project, this.meshes)) {
      this.merge(project);
      this.host.layoutStale();
      return;
    }

    this.host.constraintsChanged(this.merged, project);
  }

  private merge(project: Project): ClothSimInput | null {
    const input = this.assembly.build(project, this.meshes, this.landmarks);
    this.merged = input;
    this.mergedPositions = this.assembly.positions;
    this.flatRest = input ? mergedRestPositions(input) : new Float32Array(0);
    this.dressTargets = this.assembly.dressPositions;
    return input;
  }

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

function mergedRestPositions(input: ClothSimInput): Float32Array {
  const rest = new Float32Array(input.positions.length);
  for (const panel of input.panels) {
    rest.set(panel.restPositions, panel.vertexOffset * 3);
  }

  return rest;
}

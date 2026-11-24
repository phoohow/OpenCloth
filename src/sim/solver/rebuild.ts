import type { FabricPhysics, SimulationConfig } from '@/model/types';
import type { ClothSimInput, Constraint } from '@/sim/common';
import type { FrameFlow } from '@/sim/solver/frameFlow';
import type { Interaction } from '@/sim/solver/interaction';
import type { SelfCollisionPass } from '@/sim/solver/passes/selfCollision';

import { maxOf } from '@/base/math';
import { clothThicknessMeters } from '@/sim/common';
import { packParticleState, type ComputeCommands, type LayoutBuffers } from '@/sim/device';
import {
  buildAdjacency, buildCreaseConstraints, buildLayout, buildPanelConstraints, computeBaseInvMass,
  type LayoutTables,
} from '@/sim/particles';

export type SolverUpdate =
  | { readonly kind: 'none' }
  | { readonly kind: 'materials'; readonly physics: readonly FabricPhysics[] }
  | {
    readonly kind: 'constraints';
    readonly seams: readonly Constraint[];
    readonly creases: readonly (readonly number[])[];
  }
  | { readonly kind: 'geometry'; readonly input: ClothSimInput; readonly initial: Float32Array };

export interface RebuildDeps {
  readonly commands: ComputeCommands;
  readonly resources: LayoutBuffers;
  readonly interaction: Interaction;
  readonly flow: FrameFlow;
}

export class Rebuild {
  private currentInput: ClothSimInput | null = null;
  private physics: FabricPhysics[] = [];
  private creaseEdges: readonly (readonly number[])[] = [];
  private invMass: Float32Array = new Float32Array(0);
  private initialInvMass: Float32Array = new Float32Array(0);
  private tables: LayoutTables | null = null;
  private timeStepSeconds = 1 / 60;
  private fallbackThickness = 0.001;
  selfCollision: SelfCollisionPass | null = null;

  constructor(private readonly deps: RebuildDeps) {}

  get input(): ClothSimInput | null {
    return this.currentInput;
  }

  get layout(): LayoutTables | null {
    return this.tables;
  }

  get panelPhysics(): readonly FabricPhysics[] {
    return this.physics;
  }

  get inverseMass(): Float32Array {
    return this.invMass;
  }

  get initialInverseMass(): Float32Array {
    return this.initialInvMass;
  }

  get timeStep(): number {
    return this.timeStepSeconds;
  }

  init(input: ClothSimInput, config: SimulationConfig): LayoutTables {
    this.currentInput = input;
    this.physics = input.panels.map(panel => ({ ...panel.physics }));
    this.creaseEdges = input.panels.map(panel => panel.creaseEdges ?? []);
    this.timeStepSeconds = config.dt;
    this.fallbackThickness = clothThicknessMeters(config);
    this.tables = buildLayout(input, this.physics, this.fallbackThickness);
    this.invMass = computeBaseInvMass(input, this.physics, input.particleCount);
    this.initialInvMass = this.inverseMassWithPins();
    return this.tables;
  }

  uploadConstraints(input: ClothSimInput): void {
    const built = buildPanelConstraints(input, this.physics, this.timeStepSeconds, this.creaseEdges);
    this.deps.resources.installGroup('structural', built.structural);
    this.deps.resources.installGroup('shear', built.shear);
    this.deps.resources.installGroup('crease', built.crease);
    this.deps.resources.installGroup('seam', input.seams.slice());
    this.deps.interaction.captureSeamOpenLengths();
    this.selfCollision?.setStitchPairs(input.seams);
    this.uploadTopology(input);
  }

  uploadTopology(input: ClothSimInput): void {
    const adjacency = buildAdjacency(input.indices, input.particleCount, input.seams);
    this.deps.resources.createNormalTopology(
      adjacency.groupStart, adjacency.groupTriangles, adjacency.groupOfParticle,
    );
  }

  uploadFields(): void {
    const tables = this.tables;
    if (!tables) return;
    this.deps.commands.write(this.deps.resources.damping, tables.damping);
    this.deps.commands.write(this.deps.resources.friction, tables.friction);
    this.deps.commands.write(this.deps.resources.thickness, tables.thicknessMeters);
    this.selfCollision?.setThicknessMax(maxOf(tables.thicknessMeters));
  }

  adoptTimeStep(dt: number): boolean {
    if (!this.currentInput || dt === this.timeStepSeconds) return true;
    const previous = this.timeStepSeconds;
    this.timeStepSeconds = dt;
    if (this.adoptMaterials(this.physics)) return true;
    this.timeStepSeconds = previous;
    return false;
  }

  setCollisionFields(thickness: Float32Array, layers: Uint8Array): boolean {
    const tables = this.tables;
    const input = this.currentInput;
    if (!tables || !input || thickness.length !== input.particleCount || layers.length !== input.particleCount) {
      return false;
    }

    this.tables = { ...tables, thicknessMeters: new Float32Array(thickness), layers: new Uint8Array(layers) };
    this.uploadFields();
    this.selfCollision?.setLayers(this.tables.layers);
    return true;
  }

  forget(): void {
    this.currentInput = null;
    this.tables = null;
  }

  setPinned(index: number, pinned: boolean): void {
    this.initialInvMass[index] = pinned ? 0 : this.invMass[index]!;
  }

  restore(positions: Float32Array, dropFrames: boolean): void {
    const input = this.currentInput;
    if (!input) return;
    this.writeParticleState(positions, dropFrames);
  }

  adopt(update: SolverUpdate): boolean {
    if (!this.currentInput) return update.kind === 'none';
    switch (update.kind) {
      case 'none':
        return true;
      case 'materials':
        return this.adoptMaterials([...update.physics]);
      case 'constraints':
        return this.adoptConstraints(update.seams, update.creases);
      case 'geometry':
        return this.adoptGeometry(update.input, update.initial);
    }
  }

  private adoptMaterials(physics: FabricPhysics[]): boolean {
    const input = this.currentInput;
    if (!input || !input.panels.length || physics.length !== input.panels.length) return false;
    this.physics = physics.map(entry => ({ ...entry }));
    const built = buildPanelConstraints(input, this.physics, this.timeStepSeconds, this.creaseEdges);
    const groups: Array<['structural' | 'shear' | 'crease', Constraint[]]> = [
      ['structural', built.structural],
      ['shear', built.shear],
      ['crease', built.crease],
    ];
    for (const [kind, constraints] of groups) this.deps.resources.installGroup(kind, constraints);

    this.invMass = computeBaseInvMass(input, this.physics, input.particleCount);
    for (let i = 0; i < input.particleCount; i++) {
      this.initialInvMass[i] = this.deps.interaction.isPinned(i) ? 0 : this.invMass[i]!;
    }

    this.uploadFields();
    return true;
  }

  private adoptConstraints(seams: readonly Constraint[], creases: readonly (readonly number[])[]): boolean {
    const input = this.currentInput;
    if (!input || creases.length !== input.panels.length) return false;
    this.creaseEdges = creases.map(edges => [...edges]);
    this.deps.resources.installGroup('seam', seams.slice());
    this.deps.resources.installGroup('crease', buildCreaseConstraints(
      input, this.physics, this.timeStepSeconds, this.creaseEdges,
    ));
    this.deps.interaction.clearTears();
    this.deps.interaction.captureSeamOpenLengths();
    this.selfCollision?.setStitchPairs(seams);
    this.uploadTopology(input);
    return true;
  }

  private adoptGeometry(input: ClothSimInput, initial: Float32Array): boolean {
    const current = this.currentInput;
    const particleCount = input.particleCount;
    if (!current || particleCount !== current.particleCount) return false;
    this.currentInput = input;
    this.physics = input.panels.map(panel => ({ ...panel.physics }));
    this.tables = buildLayout(input, this.physics, this.fallbackThickness);
    this.invMass = computeBaseInvMass(input, this.physics, particleCount);
    this.initialInvMass = this.inverseMassWithPins();

    this.deps.resources.uploadIndices(input.indices);
    this.uploadTopology(input);
    this.uploadFields();
    this.selfCollision?.setLayers(this.tables.layers);

    const read = this.deps.flow.positions;
    const source = read.length >= particleCount * 3 ? read : initial;
    this.deps.flow.retarget(input.positions);
    this.writeParticleState(source, true);
    return true;
  }

  private writeParticleState(positions: Float32Array, dropFrames: boolean): void {
    const input = this.currentInput;
    if (!input) return;
    const { commands, resources } = this.deps;
    const data = packParticleState(positions, this.initialInvMass, input.particleCount);
    commands.write(resources.position, data);
    commands.write(resources.previous, data);
    commands.write(resources.predicted, data);
    commands.write(resources.velocity, new Float32Array(data.length));
    if (dropFrames) this.deps.flow.clear();
    this.deps.flow.mirror(positions);
  }

  private inverseMassWithPins(): Float32Array {
    const out = new Float32Array(this.invMass.length);
    for (let i = 0; i < out.length; i++) {
      out[i] = this.deps.interaction.isPinned(i) ? 0 : this.invMass[i]!;
    }

    return out;
  }
}

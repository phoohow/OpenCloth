import type { FabricPhysics, SimulationConfig } from '@/model/types';
import type {
  ClothSimInput, CollisionSurface, ParticleIndex, ParticlePickHit, SolverFrame, SolverStats,
  SolverStatus,
} from '@/sim/common';
import type { DevicePort } from '@/sim/device';
import type { PassContext } from '@/sim/solver/passes/substep';
import type { SolverUpdate } from '@/sim/solver/rebuild';

import { maxOf, type Vec3 } from '@/base/math';
import { frameProfiler } from '@/base/perf';
import { layerSpacingMeters, meshDensitySubsteps } from '@/sim/common';
import { packIntegrateParams, packParticles, packUpdateParams, SURFACE_OFFSET } from '@/sim/device';
import { createSimDevice, type SimDevice } from '@/sim/device/kit';
import { ParticlePicker } from '@/sim/particles';
import { Collision } from '@/sim/solver/collision';
import { FrameFlow } from '@/sim/solver/frameFlow';
import { Interaction } from '@/sim/solver/interaction';
import { liftBuriedPositions } from '@/sim/solver/lift';
import { SelfCollisionPass } from '@/sim/solver/passes/selfCollision';
import { resolvePlan, WRITE_BACK, type StepPlan } from '@/sim/solver/plan';
import { Rebuild } from '@/sim/solver/rebuild';

const FALLBACK_DAMPING = 0.02;

export interface ClothSimulator {
  readonly stats: SolverStats;
  readonly positions: Float32Array;
  readonly contact: Float32Array;
  readonly normals: Float32Array;
  readonly frame: SolverFrame;

  setup(input: ClothSimInput, surface: CollisionSurface | null, config: SimulationConfig): Promise<void>;
  step(config: SimulationConfig, physics?: FabricPhysics): void;
  readback(): Promise<SolverFrame | null>;
  readbackLatest(): Promise<SolverFrame>;

  apply(update: SolverUpdate): boolean;
  reset(initialPositions: Float32Array): void;

  pin(indices: readonly ParticleIndex[], pinned: boolean): Promise<boolean>;
  pinned(): readonly ParticleIndex[];
  grab(weights: Float32Array, target: readonly [number, number, number]): boolean;
  moveGrab(target: readonly [number, number, number]): void;
  clearGrab(): void;
  grabForceN(): number | null;

  pickRay(origin: Vec3, direction: Vec3, maxDistance: number): ParticlePickHit | null;
  pickPoint(point: Vec3, maxDistance: number, panelSlot: number): ParticlePickHit | null;

  setSeamProgress(progress: number): void;
  setPositions(positions: Float32Array): void;
  setCollisionFields(thickness: Float32Array, layers: Uint8Array): void;
  setTimeStep(dt: number): boolean;
  updateColliderVertices(vertices: Float32Array): void;
  refreshCollider(surface: CollisionSurface): void;

  destroy(): void;
}

export class SolverSession implements ClothSimulator {
  private readonly commands: SimDevice['commands'];
  private readonly resources: ReturnType<SimDevice['layoutBuffers']>;
  private readonly interaction: Interaction;
  private readonly collision: Collision;
  private readonly flow: FrameFlow;
  private readonly rebuild: Rebuild;
  private readonly picker = new ParticlePicker();
  private selfCollision: SelfCollisionPass | null = null;

  private time = 0;
  private lastConfig: SimulationConfig | null = null;
  private densitySubsteps = 1;
  private selfCollisionEnabled = true;
  private layerSpacing = 0.004;
  private seamTearing = false;

  private status: SolverStatus = 'empty';
  private lastError: string | null = null;
  private dispatches = 0;

  constructor(private readonly deps: SimDevice) {
    this.commands = deps.commands;
    this.resources = deps.layoutBuffers();
    this.interaction = new Interaction(this.commands, this.resources);
    this.collision = new Collision(deps);
    this.flow = new FrameFlow(() => this.resolveSeams());
    this.rebuild = new Rebuild({
      commands: this.commands,
      resources: this.resources,
      interaction: this.interaction,
      flow: this.flow,
    });
  }

  get ready(): boolean {
    return this.status === 'ready' && this.rebuild.input !== null;
  }

  get positions(): Float32Array {
    return this.flow.positions;
  }

  get contact(): Float32Array {
    return this.flow.frame.contact;
  }

  get normals(): Float32Array {
    return this.flow.frame.normals;
  }

  get frame(): SolverFrame {
    return this.flow.frame;
  }

  get stats(): SolverStats {
    const input = this.rebuild.input;
    return {
      status: this.status,
      particles: input?.particleCount ?? 0,
      triangles: input?.triangleCount ?? 0,
      constraints: this.resources.constraintCount(),
      batches: this.resources.solveBGs.length,
      substeps: this.resolvedSubsteps,
      dispatches: this.dispatches,
      readbackLagFrames: 1,
      timeSeconds: this.time,
      lastError: this.lastError,
    };
  }

  async setup(input: ClothSimInput, surface: CollisionSurface | null, config: SimulationConfig): Promise<void> {
    this.status = 'building';
    try {
      const particleCount = input.particleCount;
      this.lastConfig = config;
      this.densitySubsteps = meshDensitySubsteps(input.panels);
      const grabWeights = this.interaction.configure(input.pinnedIndices ?? [], particleCount);
      const tables = this.rebuild.init(input, config);
      this.collision.attach(surface);

      const start = input.positions.slice(0, particleCount * 3);
      if (config.avatarCollision) this.liftStartPositions(start);
      const particleData = packParticles(
        start, this.rebuild.inverseMass, particleCount, new Set(input.pinnedIndices ?? []),
      );

      this.resources.create({
        particleData,
        particleCount,
        indices: input.indices,
        fields: {
          damping: tables.damping,
          friction: tables.friction,
          thickness: tables.thicknessMeters,
        },
        grabWeights,
      });
      this.resources.bindAll(this.collision.buffers, this.collision.grid);

      this.selfCollision = new SelfCollisionPass(this.deps, this.deps.programs);
      this.rebuild.selfCollision = this.selfCollision;
      this.selfCollision.configure(particleCount, tables.layers);
      this.selfCollision.bind(this.resources.predicted, this.resources.position, this.resources.thickness);
      this.selfCollision.setThicknessMax(maxOf(tables.thicknessMeters));

      this.rebuild.uploadConstraints(input);
      this.flow.allocate(this.deps.readbackSlots(particleCount), input.positions, particleCount);
      this.flow.mirror(input.positions);
      this.applyStepConfig(config);
      this.status = 'ready';
      this.lastError = null;
      await this.deps.compiled();
    } catch (error) {
      this.status = 'failed';
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  step(config: SimulationConfig, physics?: FabricPhysics): void {
    if (!this.ready) return;
    const damping = physics?.damping ?? this.rebuild.panelPhysics[0]?.damping ?? FALLBACK_DAMPING;
    const base = this.commands.dispatched;
    this.advanceFrame(config, damping);
    this.writeBack(config);
    this.dispatches = this.commands.dispatched - base;
  }

  async readback(): Promise<SolverFrame | null> {
    const arrived = await this.flow.readOldest();
    return arrived ? this.flow.frame : null;
  }

  async readbackLatest(): Promise<SolverFrame> {
    return this.flow.readNewest();
  }

  reset(initialPositions: Float32Array): void {
    const input = this.rebuild.input;
    if (!input) return;
    this.interaction.grab.clear();
    const restored = initialPositions.slice(0, input.particleCount * 3);
    if (this.lastConfig?.avatarCollision) this.liftStartPositions(restored);
    this.rebuild.restore(restored, true);
    this.commands.write(this.resources.contact, this.flow.zeroContact);
    this.flow.contact.fill(0);
    this.interaction.resetSeams();
    this.selfCollision?.setStitchPairs(this.interaction.liveSeams());
    this.time = 0;
  }

  apply(update: SolverUpdate): boolean {
    return this.rebuild.adopt(update);
  }

  async pin(indices: readonly ParticleIndex[], pinned: boolean): Promise<boolean> {
    if (!this.rebuild.input) return false;
    const ok = await this.interaction.setPins(
      indices, pinned, this.rebuild.inverseMass, this.deps.programs,
    );
    if (!ok) return false;
    for (const index of indices) this.rebuild.setPinned(index, pinned);
    return true;
  }

  pinned(): readonly ParticleIndex[] {
    return this.interaction.pinnedIndices;
  }

  grab(weights: Float32Array, target: readonly [number, number, number]): boolean {
    if (!this.ready) return false;
    return this.interaction.setGrab(weights, target);
  }

  moveGrab(target: readonly [number, number, number]): void {
    this.interaction.grab.move(target);
  }

  clearGrab(): void {
    this.interaction.grab.clear();
  }

  grabForceN(): number | null {
    return this.interaction.grab.forceN();
  }

  setPositions(positions: Float32Array): void {
    this.rebuild.restore(positions, false);
  }

  setSeamProgress(progress: number): void {
    this.interaction.setSeamProgress(progress);
  }

  setCollisionFields(thickness: Float32Array, layers: Uint8Array): void {
    this.rebuild.setCollisionFields(thickness, layers);
  }

  setTimeStep(dt: number): boolean {
    if (!this.ready) return true;
    return this.rebuild.adoptTimeStep(dt);
  }

  updateColliderVertices(vertices: Float32Array): void {
    this.collision.moveVertices(vertices);
  }

  refreshCollider(surface: CollisionSurface): void {
    const replaced = this.collision.refresh(surface);
    if (replaced) this.resources.rebindCollide(this.collision.buffers, this.collision.grid);
  }

  pickRay(origin: Vec3, direction: Vec3, maxDistance: number): ParticlePickHit | null {
    const layout = this.rebuild.layout;
    const input = this.rebuild.input;
    if (!layout || !input) return null;
    this.picker.sync(this.flow.positions, input.particleCount, this.flow.version);
    return this.picker.pickRay(layout.panelMap, origin, direction, maxDistance);
  }

  pickPoint(point: Vec3, maxDistance: number, panelSlot: number): ParticlePickHit | null {
    const layout = this.rebuild.layout;
    const input = this.rebuild.input;
    if (!layout || !input) return null;
    this.picker.sync(this.flow.positions, input.particleCount, this.flow.version);
    return this.picker.pickPoint(layout.panelMap, point, maxDistance, panelSlot);
  }

  destroy(): void {
    this.status = 'empty';
    this.selfCollision?.dispose();
    this.selfCollision = null;
    this.rebuild.selfCollision = null;
    this.flow.destroy();
    this.deps.ledger.destroyAll();
    this.rebuild.forget();
    this.dispatches = 0;
    this.time = 0;
  }

  private resolveSeams(): void {
    frameProfiler.span('sim.seams', () => {
      const tore = this.interaction.resolveTears(
        this.flow.positions, this.rebuild.input?.particleCount ?? 0, this.seamTearing,
      );
      if (tore) this.selfCollision?.setStitchPairs(this.interaction.liveSeams());
    });
  }

  private get resolvedSubsteps(): number {
    const base = Math.max(1, Math.round(this.lastConfig?.substeps || 1));
    return Math.max(1, Math.round(base * this.densitySubsteps));
  }

  private advanceFrame(config: SimulationConfig, damping: number): void {
    const input = this.rebuild.input;
    if (!input) return;
    this.lastConfig = config;
    this.applyStepConfig(config);

    const particleCount = input.particleCount;
    const grabForce = this.interaction.grab.forceUniform();
    const frameStart = this.time;
    this.time += config.dt;
    const plan = resolvePlan({
      config,
      densitySubsteps: this.densitySubsteps,
      selfCollision: this.selfCollisionEnabled ? this.selfCollision : null,
    });

    if (this.flow.zeroContact.length === particleCount) {
      this.commands.write(this.resources.contact, this.flow.zeroContact);
    }

    const subDt = config.dt / plan.substeps;
    for (let sub = 0; sub < plan.substeps; sub++) {
      const subConfig: SimulationConfig = { ...config, dt: subDt };
      const subTime = frameStart + (sub + 1) * subDt;
      this.commands.begin();
      this.commands.write(this.resources.integrateParams,
        packIntegrateParams(subConfig, damping, particleCount, subTime, grabForce));
      this.commands.write(this.resources.updateParams, packUpdateParams(subConfig, particleCount));
      this.runPhases(plan, subConfig);
      this.commands.submit();
    }
  }

  private runPhases(plan: StepPlan, config: SimulationConfig): void {
    const context: PassContext = {
      commands: this.commands,
      programs: this.deps.programs,
      resources: this.resources,
      particleCount: this.rebuild.input?.particleCount ?? 0,
      config,
    };
    for (const phase of plan.phases) {
      for (let repeat = 0; repeat < phase.repeat; repeat++) phase.pass.encode(context);
    }
  }

  private writeBack(config: SimulationConfig): void {
    const input = this.rebuild.input;
    if (!input) return;
    const particleCount = input.particleCount;
    const context: PassContext = {
      commands: this.commands,
      programs: this.deps.programs,
      resources: this.resources,
      particleCount,
      config,
    };
    this.commands.begin();
    for (const pass of WRITE_BACK) pass.encode(context);
    this.flow.record(this.commands, particleCount, {
      positions: this.resources.position,
      normals: this.resources.normal,
      contact: this.resources.contact,
    });
    this.commands.submit();
  }

  private applyStepConfig(config: SimulationConfig): void {
    this.selfCollisionEnabled = config.selfCollision !== false;
    this.layerSpacing = layerSpacingMeters(config);
    this.selfCollision?.setLayerSpacing(this.layerSpacing);
    this.seamTearing = config.seamTearing === true;
  }

  private liftStartPositions(positions: Float32Array): void {
    const surface = this.collision.surface;
    if (!surface) return;
    liftBuriedPositions(
      surface, positions,
      index => this.clearanceAt(index),
      index => this.interaction.isPinned(index),
    );
  }

  private clearanceAt(index: number): number {
    return SURFACE_OFFSET + (this.rebuild.layout?.thicknessMeters[index] ?? 0);
  }
}

export function createClothSimulator(port: DevicePort): ClothSimulator {
  return new SolverSession(createSimDevice(port));
}

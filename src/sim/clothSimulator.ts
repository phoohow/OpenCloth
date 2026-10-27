import type { SimulationConfig, FabricPhysics } from '../core/model/types';
import type { AvatarSDF } from '../avatar/sdf/avatarSDF';
import { packCapsules } from '../avatar/sdf/avatarSDF';
import { packConstraints } from './buffers/constraintBuilder';
import {
  computeParticlePanelMap, ParticleGrid, pickNearest, pickNearestToPoint,
  type ParticlePickHit, type Vec3Like,
} from './picking';
import {
  createSimPipelines, createStorageBuffer, createUniformBuffer, type SimPipelines,
} from './gpuPipelines';
import {
  packCollideParams, packIntegrateParams, packPinParams, packSolveParams, packUpdateParams,
} from './simUniforms';
import {
  buildPanelConstraints, createBatchedConstraints, rewriteBatches,
} from './constraintBatches';
import { computeBaseInvMass, type BatchedConstraints, type ClothSimInput } from './simTypes';

export type { ClothSimInput } from './simTypes';

/**
 * GPU PBD cloth simulator running compute shaders on the viewport's GPUDevice and reading
 * positions back each frame to update the render mesh. Runtime particle pinning and CPU ray
 * picking work against the latest readback.
 */
export class ClothSimulator {
  constructor(private device: GPUDevice) { }

  // Particle buffers
  private posInvMassBuf!: GPUBuffer;
  private prevPosBuf!: GPUBuffer;
  private velocityBuf!: GPUBuffer;
  private predictedBuf!: GPUBuffer;
  private normalsBuf!: GPUBuffer;
  private indicesBuf!: GPUBuffer;

  // Constraint buffers, batched by type
  private structuralBatches: BatchedConstraints = { batches: [], buffers: [], count: 0 };
  private shearBatches: BatchedConstraints = { batches: [], buffers: [], count: 0 };
  private bendingBatches: BatchedConstraints = { batches: [], buffers: [], count: 0 };
  private seamBatches: BatchedConstraints = { batches: [], buffers: [], count: 0 };
  /** Seam rest lengths before any closing, per batch and constraint. */
  private seamOpenLengths: number[][] = [];

  // Body collision
  private capsuleBuf!: GPUBuffer;
  private capsuleCount = 0;

  // Uniform buffers
  private integrateParamsBuf!: GPUBuffer;
  private collideParamsBuf!: GPUBuffer;
  private updateParamsBuf!: GPUBuffer;
  private normalsParamsBuf!: GPUBuffer;
  private particleCountBuf!: GPUBuffer;

  // Runtime pinning (SET_PIN pass)
  private pinIndicesBuf!: GPUBuffer;
  private pinInvMassBuf!: GPUBuffer;
  private pinParamsBuf!: GPUBuffer;

  private pipelines!: SimPipelines;

  private integrateBG!: GPUBindGroup;
  private collideBG!: GPUBindGroup;
  private updateBG!: GPUBindGroup;
  private normalsBG!: GPUBindGroup;
  private normalizeBG!: GPUBindGroup;
  private clearNormalsBG!: GPUBindGroup;
  private setPinBG!: GPUBindGroup;
  private solveBGs: GPUBindGroup[] = [];
  /** Constraint count per solve batch, one-to-one with solveBGs. */
  private solveBatchCounts: number[] = [];
  /** Uniform buffers behind the solve bind groups, released on destroy. */
  private solveParamBufs: GPUBuffer[] = [];

  private readbackBuf!: GPUBuffer;
  private readbackNormalsBuf!: GPUBuffer;
  private readPositions!: Float32Array;
  private readNormals!: Float32Array;

  private particleCount = 0;
  private triangleCount = 0;
  private initialized = false;
  private time = 0;
  /** Floor plane height (world y); keeps cloth from falling through the floor. */
  private floorY = 0;
  /** Inverse mass captured at setup and kept in sync with live pin changes; reset() restores from it. */
  private initialPosInvMass: Float32Array = new Float32Array(0);
  /** Inverse mass of every unpinned particle, taken from its own panel's fabric weight. */
  private baseInvMass: Float32Array = new Float32Array(0);
  /** Particle indices currently pinned (inverse mass = 0). */
  private pinnedSet = new Set<number>();
  /** Setup input, kept so material edits can rebuild constraints without touching geometry. */
  private simInput: ClothSimInput | null = null;
  /** Per-panel material physics behind the live constraint buffers. */
  private panelPhysics: FabricPhysics[] = [];
  /** Time step the constraint compliances were normalised against at setup. */
  private constraintDt = 1 / 60;
  /** Particle index → panel slot (index into the setup input's panels array). */
  private panelMap: Uint32Array = new Uint32Array(0);
  /** Bumped on every readback; invalidates the pick grid. */
  private positionsVersion = 0;
  private pickGrid: ParticleGrid | null = null;
  private pickGridVersion = -1;

  /** Builds all GPU resources from the simulation input, the avatar collision body and the config. */
  async setup(input: ClothSimInput, avatarSDF: AvatarSDF | null, config: SimulationConfig): Promise<void> {
    this.particleCount = input.particleCount;
    this.triangleCount = input.triangleCount;
    const pc = this.particleCount;
    const dev = this.device;

    // ---- Per-panel material state ----
    this.simInput = input;
    this.constraintDt = config.dt;
    this.panelPhysics = input.panels.map(p => p.physics);
    this.panelMap = computeParticlePanelMap(input);
    this.baseInvMass = computeBaseInvMass(input, this.panelPhysics, pc);

    // ---- Particle buffers ----
    const posData = new Float32Array(pc * 4);
    for (let i = 0; i < pc; i++) {
      posData[i * 4] = input.positions[i * 3];
      posData[i * 4 + 1] = input.positions[i * 3 + 1];
      posData[i * 4 + 2] = input.positions[i * 3 + 2];
      posData[i * 4 + 3] = this.baseInvMass[i];
    }
    if (input.pinnedIndices) {
      for (const idx of input.pinnedIndices) posData[idx * 4 + 3] = 0;
    }

    this.pinnedSet = new Set(input.pinnedIndices ?? []);
    this.pickGrid = null;

    // Save initial state (with inverse mass) for exact restore on reset
    this.initialPosInvMass = posData.slice();

    this.posInvMassBuf = createStorageBuffer(dev, posData);
    this.prevPosBuf = createStorageBuffer(dev, posData);
    this.velocityBuf = createStorageBuffer(dev, new Float32Array(pc * 4));
    this.predictedBuf = createStorageBuffer(dev, posData);
    this.normalsBuf = createStorageBuffer(dev, new Float32Array(pc * 4));

    this.indicesBuf = dev.createBuffer({
      size: Math.max(input.indices.byteLength, 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(this.indicesBuf, 0, input.indices.buffer as ArrayBuffer, input.indices.byteOffset, input.indices.byteLength);

    // ---- Constraint build and coloring ----
    const built = buildPanelConstraints(input, this.panelPhysics, config.dt);

    this.structuralBatches = createBatchedConstraints(dev, built.structural, pc);
    this.shearBatches = createBatchedConstraints(dev, built.shear, pc);
    this.bendingBatches = createBatchedConstraints(dev, built.bending, pc);
    this.seamBatches = createBatchedConstraints(dev, input.seamConstraints, pc);
    this.seamOpenLengths = this.seamBatches.batches.map(batch => batch.map(c => c.restLength));

    // ---- Body capsules ----
    if (avatarSDF) {
      const packed = packCapsules(avatarSDF);
      this.capsuleCount = avatarSDF.capsules.length;
      this.capsuleBuf = dev.createBuffer({
        size: packed.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      dev.queue.writeBuffer(this.capsuleBuf, 0, packed.buffer as ArrayBuffer, packed.byteOffset, packed.byteLength);
    } else {
      this.capsuleCount = 0;
      this.capsuleBuf = createStorageBuffer(dev, new Float32Array(8));
    }

    // ---- Uniform buffers ----
    this.integrateParamsBuf = createUniformBuffer(dev, 64);
    this.collideParamsBuf = createUniformBuffer(dev, 32);
    this.updateParamsBuf = createUniformBuffer(dev, 32);
    this.normalsParamsBuf = createUniformBuffer(dev, 16);
    this.particleCountBuf = createUniformBuffer(dev, 16);
    // Pin lists carry one index and one inverse mass per particle.
    this.pinIndicesBuf = dev.createBuffer({
      size: Math.max(pc * 4, 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.pinInvMassBuf = dev.createBuffer({
      size: Math.max(pc * 4, 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.pinParamsBuf = createUniformBuffer(dev, 16);

    this.pipelines = createSimPipelines(dev);
    this.createBindGroups();

    // ---- Readback buffers ----
    this.readbackBuf = dev.createBuffer({
      size: pc * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.readbackNormalsBuf = dev.createBuffer({
      size: pc * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.readPositions = new Float32Array(pc * 3);
    this.readNormals = new Float32Array(pc * 3);
    this.cachePositions(input.positions);

    this.initialized = true;
  }

  /**
   * Mirrors a position write into the CPU readback cache, so picking and pin markers follow
   * the solver from the first frame instead of waiting for a GPU readback.
   */
  private cachePositions(positions: Float32Array): void {
    if (this.readPositions.length !== this.particleCount * 3) {
      this.readPositions = new Float32Array(this.particleCount * 3);
    }
    this.readPositions.set(positions.subarray(0, this.readPositions.length));
    this.positionsVersion++;
  }

  private createBindGroups(): void {
    const dev = this.device;
    const L = this.pipelines.layouts;
    const bind = (layout: GPUBindGroupLayout, buffers: GPUBuffer[]): GPUBindGroup =>
      dev.createBindGroup({
        layout,
        entries: buffers.map((buffer, binding): GPUBindGroupEntry => ({ binding, resource: { buffer } })),
      });

    this.integrateBG = bind(L.integrate,
      [this.posInvMassBuf, this.prevPosBuf, this.velocityBuf, this.predictedBuf, this.integrateParamsBuf]);
    this.collideBG = bind(L.collide,
      [this.predictedBuf, this.capsuleBuf, this.collideParamsBuf, this.prevPosBuf]);
    this.updateBG = bind(L.update,
      [this.posInvMassBuf, this.prevPosBuf, this.velocityBuf, this.predictedBuf, this.updateParamsBuf]);
    this.normalsBG = bind(L.normals,
      [this.posInvMassBuf, this.normalsBuf, this.indicesBuf, this.normalsParamsBuf]);
    this.normalizeBG = bind(L.particleCount, [this.normalsBuf, this.particleCountBuf]);
    this.clearNormalsBG = bind(L.particleCount, [this.normalsBuf, this.particleCountBuf]);
    this.setPinBG = bind(L.setPin,
      [this.posInvMassBuf, this.pinIndicesBuf, this.pinParamsBuf, this.pinInvMassBuf]);

    // One solve bind group per constraint batch, each with its own params and constraint count
    this.solveBGs = [];
    this.solveBatchCounts = [];
    const allBatches = [this.structuralBatches, this.shearBatches, this.bendingBatches, this.seamBatches];
    for (const batched of allBatches) {
      for (let b = 0; b < batched.buffers.length; b++) {
        const count = batched.batches[b].length;
        const pbuf = createUniformBuffer(dev, 32);
        dev.queue.writeBuffer(pbuf, 0, packSolveParams(this.particleCount, count));
        this.solveBatchCounts.push(count);
        this.solveParamBufs.push(pbuf);
        this.solveBGs.push(bind(L.solve,
          [this.predictedBuf, this.posInvMassBuf, batched.buffers[b], pbuf]));
      }
    }
  }

  /** Advances the simulation by one frame, split into `config.substeps` solver substeps. */
  step(config: SimulationConfig, fabric: FabricPhysics): void {
    if (!this.initialized) return;
    const dev = this.device;
    const pc = this.particleCount;
    const substeps = Math.max(1, Math.round(config.substeps || 1));
    const subDt = config.dt / substeps;
    const frameStart = this.time;
    this.time += config.dt;

    const wg = (n: number) => Math.ceil(n / 256);
    dev.queue.writeBuffer(this.particleCountBuf, 0, new Uint32Array([pc]));

    // One encoder + submit per substep: queue writes are ordered against submits,
    // so each substep's uniforms are visible only to its own dispatches.
    for (let sub = 0; sub < substeps; sub++) {
      const subConfig: SimulationConfig = { ...config, dt: subDt };
      const subTime = frameStart + (sub + 1) * subDt;
      const encoder = dev.createCommandEncoder();

      dev.queue.writeBuffer(this.integrateParamsBuf, 0, packIntegrateParams(subConfig, fabric, pc, subTime));
      dev.queue.writeBuffer(this.updateParamsBuf, 0, packUpdateParams(subConfig, fabric, pc));

      // Predict positions from velocity, gravity and wind
      {
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipelines.integrate);
        pass.setBindGroup(0, this.integrateBG);
        pass.dispatchWorkgroups(wg(pc));
        pass.end();
      }

      // Constraint iterations, solved batch by batch per graph coloring,
      // each batch with its own bind group and params
      const iterations = config.constraintIterations;
      for (let iter = 0; iter < iterations; iter++) {
        for (let s = 0; s < this.solveBGs.length; s++) {
          const count = this.solveBatchCounts[s];
          if (count === 0) continue;
          const pass = encoder.beginComputePass();
          pass.setPipeline(this.pipelines.solve);
          pass.setBindGroup(0, this.solveBGs[s]);
          pass.dispatchWorkgroups(wg(count));
          pass.end();
        }
      }

      // Body capsule collision; the floor plane is always active and always dispatched
      {
        dev.queue.writeBuffer(this.collideParamsBuf, 0,
          packCollideParams(subConfig, pc, this.capsuleCount, this.floorY));
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipelines.collide);
        pass.setBindGroup(0, this.collideBG);
        pass.dispatchWorkgroups(wg(pc));
        pass.end();
      }

      // Velocity update and position writeback
      {
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipelines.update);
        pass.setBindGroup(0, this.updateBG);
        pass.dispatchWorkgroups(wg(pc));
        pass.end();
      }

      dev.queue.submit([encoder.finish()]);
    }

    const encoder = dev.createCommandEncoder();

    // Per-particle vertex normals
    {
      const clearPass = encoder.beginComputePass();
      clearPass.setPipeline(this.pipelines.clearNormals);
      clearPass.setBindGroup(0, this.clearNormalsBG);
      clearPass.dispatchWorkgroups(wg(pc));
      clearPass.end();

      dev.queue.writeBuffer(this.normalsParamsBuf, 0, new Uint32Array([this.triangleCount, pc]));
      const nPass = encoder.beginComputePass();
      nPass.setPipeline(this.pipelines.normals);
      nPass.setBindGroup(0, this.normalsBG);
      nPass.dispatchWorkgroups(wg(this.triangleCount));
      nPass.end();

      const normPass = encoder.beginComputePass();
      normPass.setPipeline(this.pipelines.normalize);
      normPass.setBindGroup(0, this.normalizeBG);
      normPass.dispatchWorkgroups(wg(pc));
      normPass.end();
    }

    // Read back positions and normals
    encoder.copyBufferToBuffer(this.posInvMassBuf, 0, this.readbackBuf, 0, pc * 16);
    encoder.copyBufferToBuffer(this.normalsBuf, 0, this.readbackNormalsBuf, 0, pc * 16);

    dev.queue.submit([encoder.finish()]);
  }

  /**
   * Applies new per-panel material physics to the live solver: constraint compliances and
   * particle masses are rewritten in place, keeping positions, velocity source and pins.
   * Returns false when the batch layout changed and a full re-setup is required.
   */
  updateMaterialPhysics(physicsByPanel: FabricPhysics[], positions: Float32Array): boolean {
    const input = this.simInput;
    if (!input || !this.initialized || physicsByPanel.length !== input.panels.length) return false;

    this.panelPhysics = physicsByPanel.map(p => ({ ...p }));
    const built = buildPanelConstraints(input, this.panelPhysics, this.constraintDt);
    if (!rewriteBatches(this.device, this.structuralBatches, built.structural, input.particleCount)) return false;
    if (!rewriteBatches(this.device, this.shearBatches, built.shear, input.particleCount)) return false;
    if (!rewriteBatches(this.device, this.bendingBatches, built.bending, input.particleCount)) return false;

    this.baseInvMass = computeBaseInvMass(input, this.panelPhysics, input.particleCount);
    for (let i = 0; i < input.particleCount; i++) {
      const w = this.pinnedSet.has(i) ? 0 : this.baseInvMass[i];
      this.initialPosInvMass[i * 4 + 3] = w;
    }
    this.setPositions(positions);
    return true;
  }

  /**
   * Reads positions and normals back to the CPU asynchronously. Buffers destroyed mid-wait by
   * a simulator rebuild fall back to the CPU cache instead of rejecting.
   */
  async readback(): Promise<{ positions: Float32Array; normals: Float32Array }> {
    const pc = this.particleCount;
    try {
      await Promise.all([
        this.readbackBuf.mapAsync(GPUMapMode.READ),
        this.readbackNormalsBuf.mapAsync(GPUMapMode.READ),
      ]);
      const posData = new Float32Array(this.readbackBuf.getMappedRange());
      const normData = new Float32Array(this.readbackNormalsBuf.getMappedRange());

      for (let i = 0; i < pc; i++) {
        this.readPositions[i * 3] = posData[i * 4];
        this.readPositions[i * 3 + 1] = posData[i * 4 + 1];
        this.readPositions[i * 3 + 2] = posData[i * 4 + 2];
        this.readNormals[i * 3] = normData[i * 4];
        this.readNormals[i * 3 + 1] = normData[i * 4 + 1];
        this.readNormals[i * 3 + 2] = normData[i * 4 + 2];
      }
      this.readbackBuf.unmap();
      this.readbackNormalsBuf.unmap();
      this.positionsVersion++;
    } catch {
      // Destroyed readback buffers: the caller's generation is gone; serve the last cache.
    }

    return { positions: this.readPositions, normals: this.readNormals };
  }

  /** Restores the initial positions; the current pin set is preserved. */
  reset(initialPositions: Float32Array): void {
    if (!this.initialized) return;
    const pc = this.particleCount;
    const data = new Float32Array(pc * 4);
    // Inverse mass comes from initialPosInvMass, which mirrors live pin changes.
    for (let i = 0; i < pc; i++) {
      data[i * 4] = initialPositions[i * 3];
      data[i * 4 + 1] = initialPositions[i * 3 + 1];
      data[i * 4 + 2] = initialPositions[i * 3 + 2];
      data[i * 4 + 3] = this.initialPosInvMass.length > 0 ? this.initialPosInvMass[i * 4 + 3] : 1.0;
    }
    this.device.queue.writeBuffer(this.posInvMassBuf, 0, data);
    this.device.queue.writeBuffer(this.prevPosBuf, 0, data);
    this.device.queue.writeBuffer(this.predictedBuf, 0, data);
    this.device.queue.writeBuffer(this.velocityBuf, 0, new Float32Array(pc * 4));
    this.cachePositions(initialPositions);
    this.time = 0;
    this.setSeamProgress(0);
  }

  /**
   * Closes every seam by the same fraction: rest length runs from the open pair distance to zero.
   * `progress` is clamped to 0..1 and the batches are repacked into their existing buffers.
   */
  setSeamProgress(progress: number): void {
    if (this.seamBatches.buffers.length === 0) return;
    const p = Math.min(1, Math.max(0, progress));
    for (let b = 0; b < this.seamBatches.batches.length; b++) {
      const batch = this.seamBatches.batches[b];
      const open = this.seamOpenLengths[b] ?? [];
      for (let i = 0; i < batch.length; i++) batch[i].restLength = (open[i] ?? batch[i].restLength) * (1 - p);
      const packed = packConstraints(batch);
      this.device.queue.writeBuffer(this.seamBatches.buffers[b], 0, packed.data);
    }
  }

  /** Overwrites every particle position, keeping inverse mass and clearing velocity. */
  setPositions(positions: Float32Array): void {
    if (!this.initialized) return;
    const pc = this.particleCount;
    const data = new Float32Array(pc * 4);
    for (let i = 0; i < pc; i++) {
      data[i * 4] = positions[i * 3];
      data[i * 4 + 1] = positions[i * 3 + 1];
      data[i * 4 + 2] = positions[i * 3 + 2];
      data[i * 4 + 3] = this.initialPosInvMass[i * 4 + 3];
    }
    this.device.queue.writeBuffer(this.posInvMassBuf, 0, data);
    this.device.queue.writeBuffer(this.prevPosBuf, 0, data);
    this.device.queue.writeBuffer(this.predictedBuf, 0, data);
    this.device.queue.writeBuffer(this.velocityBuf, 0, new Float32Array(pc * 4));
    this.cachePositions(positions);
  }

  /** Pinned particle indices (inverse mass = 0). */
  getPinnedParticles(): readonly number[] {
    return Array.from(this.pinnedSet);
  }

  /** Latest CPU readback positions (flat xyz); does not trigger a GPU readback. */
  getReadbackPositions(): Float32Array {
    return this.readPositions;
  }

  /** Pins or unpins one particle at runtime. False when the solver rejects the index. */
  async setParticlePin(particleIndex: number, pinned: boolean): Promise<boolean> {
    return this.setParticlePins([particleIndex], pinned);
  }

  /**
   * Pins or unpins many particles in one SET_PIN pass: each one gets inverse mass 0 when
   * pinned and its own fabric mass otherwise. The same values are mirrored into
   * initialPosInvMass so reset() keeps the current pin set.
   */
  async setParticlePins(particleIndices: readonly number[], pinned: boolean): Promise<boolean> {
    if (!this.initialized) return false;
    if (particleIndices.length === 0) return true;
    if (particleIndices.length > this.particleCount) return false;
    if (particleIndices.some(i => !Number.isInteger(i) || i < 0 || i >= this.particleCount)) return false;

    const invMasses = new Float32Array(particleIndices.length);
    for (let i = 0; i < particleIndices.length; i++) {
      const index = particleIndices[i];
      invMasses[i] = pinned ? 0 : this.baseInvMass[index];
      this.initialPosInvMass[index * 4 + 3] = invMasses[i];
      if (pinned) this.pinnedSet.add(index);
      else this.pinnedSet.delete(index);
    }

    await this.dispatchSetPin(Uint32Array.from(particleIndices), invMasses);
    return true;
  }

  /** Runs the SET_PIN pass over a list of particles and waits for the submitted work to finish. */
  private async dispatchSetPin(indices: Uint32Array<ArrayBuffer>, invMasses: Float32Array<ArrayBuffer>): Promise<void> {
    const dev = this.device;
    dev.queue.writeBuffer(this.pinIndicesBuf, 0, indices);
    dev.queue.writeBuffer(this.pinInvMassBuf, 0, invMasses);
    dev.queue.writeBuffer(this.pinParamsBuf, 0, packPinParams(indices.length, this.particleCount));

    const encoder = dev.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.setPin);
    pass.setBindGroup(0, this.setPinBG);
    pass.dispatchWorkgroups(Math.ceil(indices.length / 256));
    pass.end();
    dev.queue.submit([encoder.finish()]);
    await dev.queue.onSubmittedWorkDone();
  }

  /**
   * Nearest particle to a ray within maxDistance (perpendicular, meters),
   * using the latest CPU readback positions; rebuilds the pick grid when readback data changed.
   */
  pickNearestParticle(rayOrigin: Vec3Like, rayDir: Vec3Like, maxDistance: number): ParticlePickHit | null {
    const grid = this.ensurePickGrid();
    if (!grid) return null;
    return pickNearest(this.readPositions, grid, this.panelMap, rayOrigin, rayDir, maxDistance);
  }

  /**
   * Nearest particle to a surface point within maxDistance (meters), optionally kept inside one
   * panel slot. `panelSlot` of -1 searches every panel.
   */
  pickNearestAtPoint(point: Vec3Like, maxDistance: number, panelSlot: number): ParticlePickHit | null {
    const grid = this.ensurePickGrid();
    if (!grid) return null;
    return pickNearestToPoint(this.readPositions, grid, this.panelMap, point, maxDistance, panelSlot);
  }

  /** Pick grid over the current position cache, rebuilt whenever that cache changed. */
  private ensurePickGrid(): ParticleGrid | null {
    if (!this.initialized) return null;
    if (!this.pickGrid || this.positionsVersion !== this.pickGridVersion) {
      this.pickGrid = new ParticleGrid(this.readPositions, this.particleCount);
      this.pickGridVersion = this.positionsVersion;
    }
    return this.pickGrid;
  }

  /** Stops the simulator and releases every GPU buffer it created on the shared device. */
  destroy(): void {
    if (!this.initialized) return;
    this.initialized = false;
    const buffers: (GPUBuffer | undefined)[] = [
      this.posInvMassBuf, this.prevPosBuf, this.velocityBuf, this.predictedBuf, this.normalsBuf,
      this.indicesBuf, this.capsuleBuf,
      this.integrateParamsBuf, this.collideParamsBuf, this.updateParamsBuf, this.normalsParamsBuf,
      this.particleCountBuf, this.pinIndicesBuf, this.pinInvMassBuf, this.pinParamsBuf,
      this.readbackBuf, this.readbackNormalsBuf,
      ...this.structuralBatches.buffers, ...this.shearBatches.buffers,
      ...this.bendingBatches.buffers, ...this.seamBatches.buffers,
      ...this.solveParamBufs,
    ];
    for (const buffer of buffers) buffer?.destroy();
  }
}

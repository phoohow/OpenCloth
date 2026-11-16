import { createUniformBuffer, type SimPipelines } from '@/sim/gpuPipelines';
import {
  SELF_COLLISION_MIN_CELL, SELF_COLLISION_SLOT_CAPACITY, buildStitchTable, selfCollisionSlots,
} from '@/sim/selfCollisionGrid';
import { packSelfCollisionParams } from '@/sim/simUniforms';

/** Projection rounds of the pass inside one solver substep. */
const ROUNDS_PER_SUBSTEP = 2;

/**
 * Self-collision of the cloth against itself, run on the GPU inside the solver's substep loop.
 *
 * Every round hashes the particles into a uniform grid (`clearSlots`/`fillSlots`), lets each one
 * sum the share of the overlap its own inverse mass earns against its neighbours (`project`), and
 * moves it (`applyPush`). A slot holds a bounded number of particles, so a crowded fold keeps the
 * first `SELF_COLLISION_SLOT_CAPACITY` of them instead of overflowing its list.
 *
 * Buffers that describe the cloth — layers, stitched partners — are owned here; the particle
 * buffers the rounds read and write belong to the solver and arrive through `bind`.
 */
export class SelfCollisionPass {
  private readonly device: GPUDevice;
  private readonly pipelines: SimPipelines;
  private particleCount = 0;
  private slotMask = 1023;
  private slotCountBuf!: GPUBuffer;
  private slotItemsBuf!: GPUBuffer;
  private layerBuf!: GPUBuffer;
  private pushBuf!: GPUBuffer;
  private stitchBuf!: GPUBuffer;
  private readonly paramsBuf: GPUBuffer;
  private gridBG: GPUBindGroup | null = null;
  private solveBG: GPUBindGroup | null = null;
  private predictedBuf: GPUBuffer | null = null;
  private posInvMassBuf: GPUBuffer | null = null;
  private thicknessBuf: GPUBuffer | null = null;
  /** Highest clearance of any particle, in meters. */
  private thicknessMax = 0;
  /** Lowest and highest collision layer of any particle. */
  private layerMin = 0;
  private layerMax = 0;

  constructor(device: GPUDevice, pipelines: SimPipelines) {
    this.device = device;
    this.pipelines = pipelines;
    this.paramsBuf = createUniformBuffer(device, 32);
  }

  /** Sizes the grid for a particle count and uploads the particle layers it reads. */
  configure(particleCount: number, layers: Uint8Array): void {
    this.particleCount = particleCount;
    const { slots, mask } = selfCollisionSlots(particleCount);
    this.slotMask = mask;
    this.slotCountBuf = this.grow(this.slotCountBuf, slots * 4);
    this.slotItemsBuf = this.grow(this.slotItemsBuf, slots * SELF_COLLISION_SLOT_CAPACITY * 4);
    this.pushBuf = this.grow(this.pushBuf, Math.max(particleCount, 1) * 16);
    this.setLayers(layers);
  }

  /** Replaces the per-particle collision layer and the layer span the clearance grows across. */
  setLayers(layers: Uint8Array): void {
    this.layerBuf = this.grow(this.layerBuf, Math.max(layers.length, 1) * 4);
    if (layers.length > 0) this.device.queue.writeBuffer(this.layerBuf, 0, new Uint32Array(layers));
    let min = 255;
    let max = 0;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]!;
      if (layer < min) min = layer;
      if (layer > max) max = layer;
    }
    this.layerMin = min === 255 ? 0 : min;
    this.layerMax = max;
  }

  /** Replaces the highest particle clearance, in meters. */
  setThicknessMax(thicknessMax: number): void {
    this.thicknessMax = thicknessMax;
  }

  /** Replaces the stitched partner table; sewn particles are not pushed apart from each other. */
  setStitchPairs(pairs: readonly { p0: number; p1: number }[]): void {
    const table = buildStitchTable(pairs, this.particleCount);
    this.stitchBuf = this.grow(this.stitchBuf, Math.max(table.byteLength, 4));
    if (table.byteLength > 0) this.device.queue.writeBuffer(this.stitchBuf, 0, table);
  }

  /** Cell edge the next round hashes with: wide enough for the widest clearance of any pair. */
  cellSize(layerSpacing: number): number {
    const span = Math.max(0, this.layerMax - this.layerMin) * layerSpacing;
    return Math.max(this.thicknessMax + span, SELF_COLLISION_MIN_CELL);
  }

  /** Points the rounds at the solver's particle buffers and drops the bind groups built for the old ones. */
  bind(predicted: GPUBuffer, posInvMass: GPUBuffer, thickness: GPUBuffer): void {
    this.predictedBuf = predicted;
    this.posInvMassBuf = posInvMass;
    this.thicknessBuf = thickness;
    this.gridBG = null;
    this.solveBG = null;
  }

  /** Records one substep of the pass into the encoder. */
  dispatch(encoder: GPUCommandEncoder, cellSize: number, layerSpacing: number): void {
    const predicted = this.predictedBuf;
    const posInvMass = this.posInvMassBuf;
    const thickness = this.thicknessBuf;
    if (this.particleCount === 0 || !predicted || !posInvMass || !thickness) return;
    this.ensureBindGroups(predicted, posInvMass, thickness);
    // A round may not move a particle further than one cell, so a crowded fold cannot tear itself.
    const maxMove = cellSize;
    this.device.queue.writeBuffer(this.paramsBuf, 0, packSelfCollisionParams(
      this.particleCount, this.slotMask, SELF_COLLISION_SLOT_CAPACITY, cellSize, layerSpacing, maxMove,
    ));
    const groups = Math.ceil(this.particleCount / 256);
    const slotGroups = Math.ceil((this.slotMask + 1) / 256);
    for (let round = 0; round < ROUNDS_PER_SUBSTEP; round++) {
      this.record(encoder, this.pipelines.selfClear, this.gridBG, slotGroups);
      this.record(encoder, this.pipelines.selfFill, this.gridBG, groups);
      this.record(encoder, this.pipelines.selfProject, this.solveBG, groups);
      this.record(encoder, this.pipelines.selfApply, this.solveBG, groups);
    }
  }

  /** Releases every buffer the pass owns. */
  destroy(): void {
    this.slotCountBuf?.destroy();
    this.slotItemsBuf?.destroy();
    this.layerBuf?.destroy();
    this.pushBuf?.destroy();
    this.stitchBuf?.destroy();
    this.paramsBuf.destroy();
  }

  /** One dispatch of a pass, skipped when there is nothing to visit. */
  private record(
    encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, group: GPUBindGroup | null, groups: number,
  ): void {
    if (!group || groups <= 0) return;
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(groups);
    pass.end();
  }

  /** Builds the two bind groups once per buffer set, then again after a buffer was replaced. */
  private ensureBindGroups(predicted: GPUBuffer, posInvMass: GPUBuffer, thickness: GPUBuffer): void {
    const layouts = this.pipelines.layouts;
    if (!this.gridBG) {
      this.gridBG = this.device.createBindGroup({
        layout: layouts.selfGrid,
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuf } },
          { binding: 1, resource: { buffer: predicted } },
          { binding: 2, resource: { buffer: this.slotCountBuf } },
          { binding: 3, resource: { buffer: this.slotItemsBuf } },
        ],
      });
    }
    if (!this.solveBG) {
      this.solveBG = this.device.createBindGroup({
        layout: layouts.selfSolve,
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuf } },
          { binding: 1, resource: { buffer: predicted } },
          { binding: 2, resource: { buffer: posInvMass } },
          { binding: 3, resource: { buffer: thickness } },
          { binding: 4, resource: { buffer: this.layerBuf } },
          { binding: 5, resource: { buffer: this.slotCountBuf } },
          { binding: 6, resource: { buffer: this.slotItemsBuf } },
          { binding: 7, resource: { buffer: this.stitchBuf } },
          { binding: 8, resource: { buffer: this.pushBuf } },
        ],
      });
    }
  }

  /** Grows a buffer to at least `bytes`, replacing it and dropping the bind groups that held it. */
  private grow(current: GPUBuffer | undefined, bytes: number): GPUBuffer {
    if (current && current.size >= bytes) return current;
    current?.destroy();
    this.gridBG = null;
    this.solveBG = null;
    return this.device.createBuffer({
      size: Math.max(bytes, 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }
}

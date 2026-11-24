import type { DeviceServices } from '@/sim/device/commands';
import type { PassContext, SolverPass } from '@/sim/solver/passes/substep';

import { packSelfCollisionParams, type ComputeCommands, type Programs } from '@/sim/device';

export const SELF_COLLISION_MIN_CELL = 0.01;

export const SELF_COLLISION_SLOT_CAPACITY = 24;

const ROUNDS_PER_SUBSTEP = 2;

const DEFAULT_LAYER_SPACING = 0.004;

export function selfCollisionSlots(particleCount: number): { slots: number; mask: number } {
  let slots = 1024;
  while (slots < particleCount * 2) slots <<= 1;
  return { slots, mask: slots - 1 };
}

export function buildStitchTable(
  pairs: readonly { p0: number; p1: number }[],
  particleCount: number,
): Uint32Array<ArrayBuffer> {
  const rowCount = particleCount + 1;
  const degrees = new Uint32Array(rowCount);
  const usable = pairs.filter(({ p0, p1 }) => (
    p0 !== p1 && p0 >= 0 && p1 >= 0 && p0 < particleCount && p1 < particleCount
  ));
  for (const { p0, p1 } of usable) {
    degrees[p0 + 1]! += 1;
    degrees[p1 + 1]! += 1;
  }

  const table = new Uint32Array(rowCount + usable.length * 2);
  for (let i = 0; i < particleCount; i++) table[i + 1] = table[i]! + degrees[i + 1]!;
  for (let i = 0; i <= particleCount; i++) table[i]! += rowCount;

  const fill = table.slice(0, particleCount);
  for (const { p0, p1 } of usable) {
    table[fill[p0]!++] = p1;
    table[fill[p1]!++] = p0;
  }

  return table;
}

export class SelfCollisionPass implements SolverPass {
  readonly id = 'selfCollision';

  private particleCount = 0;
  private slotMask = 1023;
  private slotCountBuf: GPUBuffer | null = null;
  private slotItemsBuf: GPUBuffer | null = null;
  private layerBuf: GPUBuffer | null = null;
  private pushBuf: GPUBuffer | null = null;
  private stitchBuf: GPUBuffer | null = null;
  private readonly paramsBuf: GPUBuffer;
  private gridBG: GPUBindGroup | null = null;
  private solveBG: GPUBindGroup | null = null;
  private predictedBuf: GPUBuffer | null = null;
  private posInvMassBuf: GPUBuffer | null = null;
  private thicknessBuf: GPUBuffer | null = null;
  private thicknessMax = 0;
  private layerMin = 0;
  private layerMax = 0;
  private layerSpacing = DEFAULT_LAYER_SPACING;

  constructor(
    private readonly services: DeviceServices,
    private readonly programs: Programs,
  ) {
    this.paramsBuf = services.ledger.uniform(32);
  }

  private get commands(): ComputeCommands {
    return this.services.commands;
  }

  configure(particleCount: number, layers: Uint8Array): void {
    this.particleCount = particleCount;
    const { slots, mask } = selfCollisionSlots(particleCount);
    this.slotMask = mask;
    this.slotCountBuf = this.grow(this.slotCountBuf, slots * 4);
    this.slotItemsBuf = this.grow(this.slotItemsBuf, slots * SELF_COLLISION_SLOT_CAPACITY * 4);
    this.pushBuf = this.grow(this.pushBuf, Math.max(particleCount, 1) * 16);
    this.setLayers(layers);
  }

  setLayers(layers: Uint8Array): void {
    this.layerBuf = this.grow(this.layerBuf, Math.max(layers.length, 1) * 4);
    if (layers.length > 0) this.commands.write(this.layerBuf, new Uint32Array(layers));
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

  setThicknessMax(thicknessMax: number): void {
    this.thicknessMax = thicknessMax;
  }

  setLayerSpacing(layerSpacing: number): void {
    this.layerSpacing = layerSpacing;
  }

  setStitchPairs(pairs: readonly { p0: number; p1: number }[]): void {
    const table = buildStitchTable(pairs, this.particleCount);
    this.stitchBuf = this.grow(this.stitchBuf, Math.max(table.byteLength, 4));
    if (table.byteLength > 0) this.commands.write(this.stitchBuf, table);
  }

  cellSize(): number {
    const span = Math.max(0, this.layerMax - this.layerMin) * this.layerSpacing;
    return Math.max(this.thicknessMax + span, SELF_COLLISION_MIN_CELL);
  }

  bind(predicted: GPUBuffer, posInvMass: GPUBuffer, thickness: GPUBuffer): void {
    this.predictedBuf = predicted;
    this.posInvMassBuf = posInvMass;
    this.thicknessBuf = thickness;
    this.gridBG = null;
    this.solveBG = null;
  }

  encode({ commands }: PassContext): void {
    this.dispatch(commands);
  }

  dispose(): void {
    for (const buffer of [
      this.slotCountBuf, this.slotItemsBuf, this.layerBuf, this.pushBuf, this.stitchBuf, this.paramsBuf,
    ]) {
      this.services.ledger.release(buffer ?? undefined);
    }

    this.slotCountBuf = null;
    this.slotItemsBuf = null;
    this.layerBuf = null;
    this.pushBuf = null;
    this.stitchBuf = null;
    this.gridBG = null;
    this.solveBG = null;
  }

  private dispatch(commands: ComputeCommands): void {
    const predicted = this.predictedBuf;
    const posInvMass = this.posInvMassBuf;
    const thickness = this.thicknessBuf;
    if (this.particleCount === 0 || !predicted || !posInvMass || !thickness) return;
    this.ensureBindGroups(predicted, posInvMass, thickness);
    const cellSize = this.cellSize();
    const maxMove = cellSize;
    commands.write(this.paramsBuf, packSelfCollisionParams(
      this.particleCount, this.slotMask, SELF_COLLISION_SLOT_CAPACITY, cellSize, this.layerSpacing, maxMove,
    ));
    const groups = Math.ceil(this.particleCount / 256);
    const slotGroups = Math.ceil((this.slotMask + 1) / 256);
    for (let round = 0; round < ROUNDS_PER_SUBSTEP; round++) {
      this.record(commands, this.programs.selfClear, this.gridBG, slotGroups);
      this.record(commands, this.programs.selfFill, this.gridBG, groups);
      this.record(commands, this.programs.selfProject, this.solveBG, groups);
      this.record(commands, this.programs.selfApply, this.solveBG, groups);
    }
  }

  private record(
    commands: ComputeCommands, pipeline: GPUComputePipeline, group: GPUBindGroup | null, groups: number,
  ): void {
    if (!group || groups <= 0) return;
    commands.dispatch(pipeline, group, groups);
  }

  private ensureBindGroups(predicted: GPUBuffer, posInvMass: GPUBuffer, thickness: GPUBuffer): void {
    const layouts = this.programs.layouts;
    if (!this.gridBG) {
      this.gridBG = this.services.bindGroup(layouts.selfGrid, [
        this.paramsBuf, predicted, this.slotCountBuf!, this.slotItemsBuf!,
      ]);
    }

    if (!this.solveBG) {
      this.solveBG = this.services.bindGroup(layouts.selfSolve, [
        this.paramsBuf, predicted, posInvMass, thickness, this.layerBuf!,
        this.slotCountBuf!, this.slotItemsBuf!, this.stitchBuf!, this.pushBuf!,
      ]);
    }
  }

  private grow(current: GPUBuffer | null, bytes: number): GPUBuffer {
    if (current && current.size >= bytes) return current;
    this.services.ledger.release(current ?? undefined);
    this.gridBG = null;
    this.solveBG = null;
    return this.services.storageSized(bytes);
  }
}

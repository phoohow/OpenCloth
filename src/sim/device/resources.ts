import type { ColliderGrid, Constraint, ConstraintGroupKind } from '@/sim/common';
import type { ComputeCommands } from '@/sim/device/commands';

import { CONSTRAINT_GROUP_ORDER } from '@/sim/common';
import { type BodyBuffers } from '@/sim/device/bodyBuffers';
import { bindGroupOf, type ResourceLedger } from '@/sim/device/buffers';
import { colorConstraints, packConstraints } from '@/sim/device/pack';
import { packSolveParams } from '@/sim/device/pack';
import { type Programs } from '@/sim/device/programs';

export interface BatchedConstraints {
  batches: Constraint[][];
  readonly buffers: GPUBuffer[];
  readonly count: number;
}

export interface ConstraintGroup {
  readonly batched: BatchedConstraints;
  readonly bindGroups: GPUBindGroup[];
  readonly counts: number[];
  readonly paramBufs: GPUBuffer[];
}

export interface MaterialFields {
  readonly damping: Float32Array;
  readonly friction: Float32Array;
  readonly thickness: Float32Array;
}

export class LayoutBuffers {
  particleCount = 0;

  position!: GPUBuffer;
  previous!: GPUBuffer;
  velocity!: GPUBuffer;
  predicted!: GPUBuffer;
  normal!: GPUBuffer;
  contact!: GPUBuffer;
  indices!: GPUBuffer;
  groupStart!: GPUBuffer;
  groupTriangles!: GPUBuffer;
  groupOfParticle!: GPUBuffer;
  damping!: GPUBuffer;
  friction!: GPUBuffer;
  thickness!: GPUBuffer;
  grabWeights!: GPUBuffer;

  integrateParams!: GPUBuffer;
  collideParams!: GPUBuffer;
  updateParams!: GPUBuffer;
  normalsParams!: GPUBuffer;
  pinIndices!: GPUBuffer;
  pinInvMass!: GPUBuffer;
  pinParams!: GPUBuffer;

  collideBody: ColliderGrid = { triangleCount: 0, origin: [0, 0, 0], cell: 1, dims: [0, 0, 0] };

  readonly groups = new Map<ConstraintGroupKind, ConstraintGroup>();
  integrateBG!: GPUBindGroup;
  collideBG!: GPUBindGroup;
  updateBG!: GPUBindGroup;
  normalsBG!: GPUBindGroup;
  setPinBG!: GPUBindGroup;
  solveBGs: GPUBindGroup[] = [];
  solveCounts: number[] = [];

  constructor(
    readonly device: GPUDevice,
    readonly programs: Programs,
    readonly ledger: ResourceLedger,
    private readonly commands: ComputeCommands,
  ) {}

  create(params: {
    particleData: Float32Array;
    particleCount: number;
    indices: Uint32Array;
    fields: MaterialFields;
    grabWeights: Float32Array;
  }): void {
    const { particleData, particleCount, indices, fields } = params;
    this.particleCount = particleCount;
    const store = (data: ArrayBufferView) => this.ledger.storage(data);

    this.position = store(particleData);
    this.previous = store(particleData);
    this.velocity = store(new Float32Array(particleCount * 4));
    this.predicted = store(particleData);
    this.normal = store(new Float32Array(particleCount * 4));
    this.contact = store(new Float32Array(particleCount));
    this.damping = store(fields.damping);
    this.friction = store(fields.friction);
    this.thickness = store(fields.thickness);
    this.grabWeights = store(params.grabWeights);

    this.uploadIndices(indices);
    this.integrateParams = this.ledger.uniform(80);
    this.collideParams = this.ledger.uniform(64);
    this.updateParams = this.ledger.uniform(32);
    this.normalsParams = this.ledger.uniform(16);
    this.pinIndices = this.ledger.storage(null);
    this.pinInvMass = this.ledger.storage(null);
    this.pinParams = this.ledger.uniform(16);
    this.createNormalTopology(new Uint32Array([0]), new Uint32Array([0]), new Uint32Array(particleCount));
  }

  uploadIndices(indices: Uint32Array): void {
    if (this.indices && this.indices.size >= indices.byteLength) {
      this.commands.write(this.indices, indices);
      return;
    }

    this.ledger.release(this.indices);
    this.indices = this.ledger.storage(indices);
  }

  createNormalTopology(groupStart: Uint32Array, groupTriangles: Uint32Array, groupOfParticle: Uint32Array): void {
    for (const buffer of [this.groupStart, this.groupTriangles, this.groupOfParticle]) this.ledger.release(buffer);
    const triangles = groupTriangles.byteLength > 0 ? groupTriangles : new Uint32Array(1);
    this.groupStart = this.ledger.storage(groupStart);
    this.groupTriangles = this.ledger.storage(triangles);
    this.groupOfParticle = this.ledger.storage(groupOfParticle);
    this.rebindNormals();
  }

  bindAll(body: BodyBuffers, grid: ColliderGrid): void {
    this.integrateBG = this.bindGroup(this.programs.layouts.integrate, [
      this.position, this.previous, this.velocity, this.predicted, this.integrateParams, this.grabWeights,
    ]);
    this.updateBG = this.bindGroup(this.programs.layouts.update, [
      this.position, this.previous, this.velocity, this.predicted, this.updateParams, this.damping,
    ]);
    this.setPinBG = this.bindGroup(this.programs.layouts.setPin, [
      this.position, this.pinIndices, this.pinParams, this.pinInvMass,
    ]);
    this.rebindCollide(body, grid);
    this.rebindNormals();
  }

  rebindCollide(body: BodyBuffers, grid: ColliderGrid): void {
    this.collideBody = grid;
    this.collideBG = this.bindGroup(this.programs.layouts.collide, [
      this.predicted, this.collideParams, this.previous,
      body.triangle, body.cellStart, body.cellTriangles, this.contact,
      this.thickness, this.friction,
    ]);
  }

  rebindNormals(): void {
    this.normalsBG = this.bindGroup(this.programs.layouts.normals, [
      this.position, this.normal, this.indices,
      this.groupStart, this.groupTriangles, this.groupOfParticle, this.normalsParams,
    ]);
  }

  installGroup(kind: ConstraintGroupKind, constraints: Constraint[]): void {
    const previous = this.groups.get(kind);
    for (const buffer of previous?.batched.buffers ?? []) this.ledger.release(buffer);
    for (const buffer of previous?.paramBufs ?? []) this.ledger.release(buffer);

    const batches = colorConstraints(constraints);
    const buffers: GPUBuffer[] = [];
    for (const batch of batches) {
      const packed = new Uint8Array(packConstraints(batch));
      const buffer = this.device.createBuffer({
        size: Math.max(packed.byteLength, 16),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.commands.write(buffer, packed);
      buffers.push(this.ledger.track(buffer));
    }

    const group: ConstraintGroup = {
      batched: { batches, buffers, count: constraints.length },
      bindGroups: [], counts: [], paramBufs: [],
    };
    const layout = this.programs.layouts.solve;
    for (let b = 0; b < buffers.length; b++) {
      const count = batches[b]!.length;
      const paramBuf = this.ledger.uniform(32);
      this.commands.write(paramBuf, packSolveParams(this.particleCount, count));
      group.paramBufs.push(paramBuf);
      group.counts.push(count);
      group.bindGroups.push(this.bindGroup(layout, [
        this.predicted, this.position, buffers[b]!, paramBuf,
      ]));
    }

    this.groups.set(kind, group);
    this.rebuildSolveList();
  }

  uploadBatch(kind: ConstraintGroupKind, batch: number): void {
    const group = this.groups.get(kind);
    if (!group) return;
    const buffer = group.batched.buffers[batch];
    const constraints = group.batched.batches[batch];
    if (!buffer || !constraints) return;
    this.commands.write(buffer, new Uint8Array(packConstraints(constraints)));
  }

  group(kind: ConstraintGroupKind): ConstraintGroup {
    const group = this.groups.get(kind);
    if (!group) throw new Error(`Constraint group ${kind} is not installed`);
    return group;
  }

  rebuildSolveList(): void {
    this.solveBGs = [];
    this.solveCounts = [];
    for (const kind of CONSTRAINT_GROUP_ORDER) {
      const group = this.groups.get(kind);
      if (!group) continue;
      this.solveBGs.push(...group.bindGroups);
      this.solveCounts.push(...group.counts);
    }
  }

  constraintCount(): number {
    return this.solveCounts.reduce((sum, count) => sum + count, 0);
  }

  private bindGroup(layout: GPUBindGroupLayout, buffers: GPUBuffer[]): GPUBindGroup {
    return bindGroupOf(this.device, layout, buffers);
  }
}

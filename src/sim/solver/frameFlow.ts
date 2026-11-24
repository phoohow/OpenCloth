import type { SolverFrame } from '@/sim/common';
import type { ComputeCommands, ReadbackSlots } from '@/sim/device';

export interface FrameSources {
  readonly positions: GPUBuffer;
  readonly normals: GPUBuffer;
  readonly contact: GPUBuffer;
}

export class FrameFlow {
  positions: Float32Array = new Float32Array(0);
  normals: Float32Array = new Float32Array(0);
  contact: Float32Array = new Float32Array(0);

  private lastGood: Float32Array = new Float32Array(0);
  private lastGoodNormals: Float32Array = new Float32Array(0);
  private lastGoodContact: Float32Array = new Float32Array(0);
  private zeros: Float32Array = new Float32Array(0);
  private slots: ReadbackSlots | null = null;
  private readVersion = 0;

  constructor(private readonly onFrame?: () => void) {}

  allocate(slots: ReadbackSlots, positions: Float32Array, particleCount: number): void {
    this.slots = slots;
    this.positions = positions;
    this.normals = new Float32Array(particleCount * 3);
    this.contact = new Float32Array(particleCount);
    this.zeros = new Float32Array(particleCount);
    this.lastGood = new Float32Array(0);
    this.lastGoodNormals = new Float32Array(0);
    this.lastGoodContact = new Float32Array(0);
    this.readVersion = 0;
  }

  get version(): number {
    return this.readVersion;
  }

  get zeroContact(): Float32Array {
    return this.zeros;
  }

  get frame(): SolverFrame {
    const held = this.lastGood.length > 0;
    return {
      positions: held ? this.lastGood : this.positions,
      normals: held ? this.lastGoodNormals : this.normals,
      contact: held ? this.lastGoodContact : this.contact,
    };
  }

  mirror(positions: Float32Array): void {
    this.positions.set(positions.subarray(0, this.positions.length));
    this.readVersion++;
  }

  retarget(positions: Float32Array): void {
    this.positions = positions;
    this.readVersion++;
  }

  record(commands: ComputeCommands, particleCount: number, sources: FrameSources): void {
    this.slots?.record(commands, particleCount, sources);
  }

  clear(): void {
    this.slots?.clear();
  }

  async readOldest(): Promise<boolean> {
    const index = this.slots?.oldest() ?? null;
    if (index === null) return false;
    await this.map(index);
    return true;
  }

  async readNewest(): Promise<SolverFrame> {
    const index = this.slots?.newest() ?? null;
    if (index === null) return this.frame;
    await this.map(index);
    return this.frame;
  }

  destroy(): void {
    this.slots?.destroy();
    this.slots = null;
    this.lastGood = new Float32Array(0);
    this.lastGoodNormals = new Float32Array(0);
    this.lastGoodContact = new Float32Array(0);
    this.readVersion = 0;
  }

  private async map(index: number): Promise<void> {
    const slots = this.slots;
    if (!slots) return;
    try {
      await slots.read(index, this.positions, this.normals, this.contact);
      this.onFrame?.();
      this.readVersion++;
      this.accept();
    } catch {
    }
  }

  private accept(): void {
    if (firstNonFinite(this.positions) >= 0) return;
    if (this.lastGood.length !== this.positions.length) this.lastGood = new Float32Array(this.positions.length);
    this.lastGood.set(this.positions);
    if (this.lastGoodNormals.length !== this.normals.length) {
      this.lastGoodNormals = new Float32Array(this.normals.length);
    }

    this.lastGoodNormals.set(this.normals);
    if (this.lastGoodContact.length !== this.contact.length) {
      this.lastGoodContact = new Float32Array(this.contact.length);
    }

    this.lastGoodContact.set(this.contact);
  }
}

function firstNonFinite(positions: Float32Array): number {
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) return Math.floor(i / 3);
  }

  return -1;
}

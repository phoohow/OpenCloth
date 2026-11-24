import type { ComputeCommands } from '@/sim/device/commands';

import { frameProfiler } from '@/base/perf';
import { createReadback, type ResourceLedger } from '@/sim/device/buffers';

interface FrameBuffers {
  positions: GPUBuffer;
  normals: GPUBuffer;
  contact: GPUBuffer;
}

export class ReadbackSlots {
  private readonly slots: FrameBuffers[];
  private write = 0;
  private unread: number[] = [];

  constructor(device: GPUDevice, particleCount: number, private readonly ledger: ResourceLedger) {
    const read = (size: number) => ledger.track(createReadback(device, size));
    this.slots = [0, 1].map(() => ({
      positions: read(particleCount * 16),
      normals: read(particleCount * 16),
      contact: read(Math.max(particleCount * 4, 4)),
    }));
  }

  record(commands: ComputeCommands, particleCount: number, source: FrameBuffers): void {
    const slot = this.slots[this.write]!;
    commands.copy(source.positions, slot.positions, particleCount * 16);
    commands.copy(source.normals, slot.normals, particleCount * 16);
    commands.copy(source.contact, slot.contact, particleCount * 4);
    while (this.unread.length >= this.slots.length) this.unread.shift();
    this.unread.push(this.write);
    this.write = (this.write + 1) % this.slots.length;
  }

  oldest(): number | null {
    return this.unread.length < this.slots.length ? null : this.unread.shift()!;
  }

  newest(): number | null {
    const index = this.unread.pop();
    this.unread.length = 0;
    return index ?? null;
  }

  clear(): void {
    this.unread.length = 0;
  }

  async read(
    index: number, positions: Float32Array, normals: Float32Array, contact: Float32Array,
  ): Promise<void> {
    const slot = this.slots[index]!;
    const count = Math.floor(positions.length / 3);
    try {
      await frameProfiler.spanAsync('sim.map', () => Promise.all([
        slot.positions.mapAsync(GPUMapMode.READ),
        slot.normals.mapAsync(GPUMapMode.READ),
        slot.contact.mapAsync(GPUMapMode.READ),
      ]));
      const posData = new Float32Array(slot.positions.getMappedRange());
      const normData = new Float32Array(slot.normals.getMappedRange());
      const contactData = new Float32Array(slot.contact.getMappedRange());
      frameProfiler.span('sim.unpack', () => {
        for (let i = 0; i < count; i++) {
          positions[i * 3] = posData[i * 4]!;
          positions[i * 3 + 1] = posData[i * 4 + 1]!;
          positions[i * 3 + 2] = posData[i * 4 + 2]!;
          normals[i * 3] = normData[i * 4]!;
          normals[i * 3 + 1] = normData[i * 4 + 1]!;
          normals[i * 3 + 2] = normData[i * 4 + 2]!;
          contact[i] = contactData[i]!;
        }
      });
    } finally {
      slot.positions.unmap();
      slot.normals.unmap();
      slot.contact.unmap();
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      for (const buffer of [slot.positions, slot.normals, slot.contact]) this.ledger.release(buffer);
    }

    this.clear();
    this.write = 0;
  }
}

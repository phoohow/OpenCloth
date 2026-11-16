import { frameProfiler } from '@/base/perf';

/** One frame of the solver as the CPU sees it. */
export interface SolverFrame {
  positions: Float32Array;
  normals: Float32Array;
}

/** The buffers of one frame that the CPU copies back. */
interface FrameBuffers {
  positions: GPUBuffer;
  normals: GPUBuffer;
  contact: GPUBuffer;
}

/**
 * Two copies of the frame in flight, so a frame is written into a slot when it is submitted and
 * read one frame later. By then the copy has had a whole frame of GPU time behind it, and mapping
 * it no longer waits for the queue it was submitted into.
 */
export class ReadbackSlots {
  private readonly slots: FrameBuffers[];
  /** Slot the next frame is copied into. */
  private write = 0;
  /** Slots holding a copy the CPU has not read, oldest first. */
  private unread: number[] = [];

  constructor(device: GPUDevice, particleCount: number) {
    const read = (size: number) => device.createBuffer({
      size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.slots = [0, 1].map(() => ({
      positions: read(particleCount * 16),
      normals: read(particleCount * 16),
      contact: read(Math.max(particleCount * 4, 4)),
    }));
  }

  /** Records the copies of one submitted frame into the next slot. */
  record(encoder: GPUCommandEncoder, particleCount: number, source: FrameBuffers): void {
    const slot = this.slots[this.write]!;
    encoder.copyBufferToBuffer(source.positions, 0, slot.positions, 0, particleCount * 16);
    encoder.copyBufferToBuffer(source.normals, 0, slot.normals, 0, particleCount * 16);
    encoder.copyBufferToBuffer(source.contact, 0, slot.contact, 0, particleCount * 4);
    // A caller that stops reading drops its copy here rather than hold a slot the new frame needs.
    while (this.unread.length >= this.slots.length) this.unread.shift();
    this.unread.push(this.write);
    this.write = (this.write + 1) % this.slots.length;
  }

  /** The oldest copy that has been in flight a whole frame; null while only the newest exists. */
  oldest(): number | null {
    return this.unread.length < this.slots.length ? null : this.unread.shift()!;
  }

  /** The newest copy, dropping the older unread ones; null when no frame is pending. */
  newest(): number | null {
    const index = this.unread.pop();
    this.unread.length = 0;
    return index ?? null;
  }

  /** Forgets every unread copy, for when the layout they describe is gone. */
  clear(): void {
    this.unread.length = 0;
  }

  /** Maps one slot and unpacks it into the three per-particle arrays. */
  async read(
    index: number, positions: Float32Array, normals: Float32Array, contact: Float32Array,
  ): Promise<void> {
    const slot = this.slots[index]!;
    const count = Math.floor(positions.length / 3);
    await frameProfiler.spanAsync('sim.map', () => Promise.all([
      slot.positions.mapAsync(GPUMapMode.READ),
      slot.normals.mapAsync(GPUMapMode.READ),
      slot.contact.mapAsync(GPUMapMode.READ),
    ]));
    const posData = new Float32Array(slot.positions.getMappedRange());
    const normData = new Float32Array(slot.normals.getMappedRange());
    const contactData = new Float32Array(slot.contact.getMappedRange());
    try {
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
      // A mapped buffer cannot be copied into or destroyed; the copies must not stay behind.
      slot.positions.unmap();
      slot.normals.unmap();
      slot.contact.unmap();
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      slot.positions.destroy();
      slot.normals.destroy();
      slot.contact.destroy();
    }
    this.clear();
    this.write = 0;
  }
}

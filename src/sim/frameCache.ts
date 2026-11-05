/** One sampled simulation frame. */
export interface CachedFrame {
  /** Sample index within the cache, starting at 1. */
  index: number;
  /** Simulation time in seconds when the frame was captured. */
  timeSeconds: number;
  /** Flat xyz particle positions in meters. */
  positions: Float32Array;
}

/** Fixed-size ring buffer of recent simulation frames; the oldest samples fall off. */
export class FrameCache {
  private readonly storage: CachedFrame[] = [];
  private nextIndex = 1;
  private writeAt = 0;

  constructor(private readonly capacity = 90) { }

  /** Copies the positions into the next slot, dropping the oldest frame when full. */
  push(positions: Float32Array, timeSeconds: number): void {
    const frame: CachedFrame = {
      index: this.nextIndex++,
      timeSeconds,
      positions: positions.slice(),
    };
    if (this.storage.length < this.capacity) {
      this.storage.push(frame);
      this.writeAt = (this.writeAt + 1) % this.capacity;
      return;
    }
    this.storage[this.writeAt] = frame;
    this.writeAt = (this.writeAt + 1) % this.capacity;
  }

  /** Captured frames, oldest first. */
  frames(): readonly CachedFrame[] {
    if (this.storage.length < this.capacity) return [...this.storage];
    return [...this.storage.slice(this.writeAt), ...this.storage.slice(0, this.writeAt)];
  }

  /** Number of frames currently cached. */
  get count(): number {
    return this.storage.length;
  }

  /** Drops every captured frame and restarts sample numbering. */
  clear(): void {
    this.storage.length = 0;
    this.writeAt = 0;
    this.nextIndex = 1;
  }
}

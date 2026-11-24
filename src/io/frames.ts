export interface CachedFrame {
  readonly index: number;
  readonly timeSeconds: number;
  readonly positions: Float32Array;
}

export class FrameCache {
  private readonly storage: CachedFrame[] = [];
  private nextIndex = 1;
  private writeAt = 0;

  constructor(private readonly capacity = 90) {}

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

  frames(): readonly CachedFrame[] {
    if (this.storage.length < this.capacity) return [...this.storage];
    return [...this.storage.slice(this.writeAt), ...this.storage.slice(0, this.writeAt)];
  }

  get count(): number {
    return this.storage.length;
  }

  clear(): void {
    this.storage.length = 0;
    this.writeAt = 0;
    this.nextIndex = 1;
  }
}

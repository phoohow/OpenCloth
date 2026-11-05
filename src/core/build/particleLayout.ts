/** Half-open particle range of one panel inside the merged cloth. */
export interface ParticleRange {
  readonly start: number;
  readonly end: number;
}

/** One panel's slice of the merged particle array. */
export interface PanelSlice {
  readonly panelId: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Bidirectional map between panels and the merged particle array. Panels occupy contiguous
 * slices, so both directions resolve in constant time.
 */
export class ParticleLayout {
  private readonly ranges = new Map<string, ParticleRange>();
  private readonly slots = new Map<string, number>();
  private readonly panelIds: string[];
  private readonly ownerOf: (string | null)[];

  private constructor(slices: readonly PanelSlice[], readonly particleCount: number) {
    this.ownerOf = new Array<string | null>(particleCount).fill(null);
    this.panelIds = slices.map(slice => slice.panelId);
    slices.forEach((slice, slot) => {
      this.ranges.set(slice.panelId, { start: slice.start, end: slice.end });
      this.slots.set(slice.panelId, slot);
      for (let i = slice.start; i < slice.end && i < particleCount; i++) this.ownerOf[i] = slice.panelId;
    });
  }

  /** Lays out panels in slice order; a particle's owner is the first panel covering it. */
  static of(slices: readonly PanelSlice[], particleCount: number): ParticleLayout {
    return new ParticleLayout(slices, particleCount);
  }

  /** Panels in merge order; the index is the slot number. */
  get panels(): readonly string[] { return this.panelIds; }

  /** Slice of a panel, or null when it contributes no particles. */
  rangeOf(panelId: string): ParticleRange | null {
    return this.ranges.get(panelId) ?? null;
  }

  /** Slot index of a panel, or -1. */
  slotOf(panelId: string): number {
    return this.slots.get(panelId) ?? -1;
  }

  /** Panel owning a particle, or null outside every slice. */
  panelAt(particle: number): string | null {
    return this.ownerOf[particle] ?? null;
  }

  /** Vertex count of a panel's slice. */
  countOf(panelId: string): number {
    const range = this.ranges.get(panelId);
    return range ? range.end - range.start : 0;
  }
}

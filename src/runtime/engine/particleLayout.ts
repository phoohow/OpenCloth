export interface ParticleRange {
  readonly start: number;
  readonly end: number;
}

export interface PanelSlice {
  readonly panelId: string;
  readonly start: number;
  readonly end: number;
}

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

  static of(slices: readonly PanelSlice[], particleCount: number): ParticleLayout {
    return new ParticleLayout(slices, particleCount);
  }

  get panels(): readonly string[] { return this.panelIds; }

  rangeOf(panelId: string): ParticleRange | null {
    return this.ranges.get(panelId) ?? null;
  }

  slotOf(panelId: string): number {
    return this.slots.get(panelId) ?? -1;
  }

  panelAt(particle: number): string | null {
    return this.ownerOf[particle] ?? null;
  }

  countOf(panelId: string): number {
    const range = this.ranges.get(panelId);
    return range ? range.end - range.start : 0;
  }
}

import type { ClothSimInput } from '@/sim/common';

import {
  dynamicFrame, pushDynamicFrame, type DynamicPressureFrame, computePressureField, pressureStats,
} from '@/analysis';

const SAMPLE_EVERY = 4;

export interface DynamicFitHost {
  isAnimating(): boolean;
  clipTimeSeconds(): number;
  contact(): Float32Array | null;
  clothInput(): ClothSimInput | null;
}

export class DynamicFitSampler {
  private frames: DynamicPressureFrame[] = [];
  private enabled = false;
  private countdown = 0;
  private seq = 0;

  constructor(private readonly host: DynamicFitHost) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.countdown = 0;
  }

  clear(): void {
    this.frames = [];
    this.seq = 0;
  }

  get samples(): readonly DynamicPressureFrame[] {
    return this.frames;
  }

  get count(): number {
    return this.frames.length;
  }

  sample(): void {
    if (!this.enabled || !this.host.isAnimating()) return;
    if (this.countdown > 0) {
      this.countdown--;
      return;
    }

    this.countdown = SAMPLE_EVERY;
    const contact = this.host.contact();
    if (!contact) return;
    const field = computePressureField(contact);
    const panels = this.host.clothInput()?.panels.map(panel => ({
      panelId: panel.panelId,
      vertexOffset: panel.vertexOffset,
      vertexCount: panel.mesh.vertexCount,
    })) ?? [];
    pushDynamicFrame(
      this.frames,
      dynamicFrame(this.host.clipTimeSeconds() * 1000, this.seq++, pressureStats(field, panels)),
    );
  }
}

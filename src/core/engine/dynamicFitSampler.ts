import {
  dynamicFrame, pushDynamicFrame, type DynamicPressureFrame,
} from '../../render/analysis/dynamicPressure';
import { computePressureField, pressureStats } from '../../render/analysis/pressure';
import type { ClothSimInput } from '../../sim/simTypes';

/** What the sampler reads from the engine while the avatar animation plays. */
export interface DynamicFitHost {
  /** True while a body animation is playing; nothing is sampled otherwise. */
  isAnimating(): boolean;
  /** Playhead of the current clip, in seconds. */
  clipTimeSeconds(): number;
  /** Contact indentation read back with the last step. */
  contact(): Float32Array | null;
  /** Merged layout, for per-panel pressure stats. */
  clothInput(): ClothSimInput | null;
}

/** Steps between two samples; the pressure pass is heavier than a solver step. */
const SAMPLE_EVERY = 4;

/**
 * Records one pressure sample every fifth step while the body animation plays. Sampling is a
 * UI-level switch: turning it off keeps the samples already taken, and the buffer is capped
 * by `pushDynamicFrame`.
 */
export class DynamicFitSampler {
  private frames: DynamicPressureFrame[] = [];
  private enabled = false;
  private countdown = 0;
  private seq = 0;

  constructor(private readonly host: DynamicFitHost) { }

  /** Turns sampling on or off; turning it on keeps earlier samples. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.countdown = 0;
  }

  /** Drops every recorded sample and restarts the sequence. */
  clear(): void {
    this.frames = [];
    this.seq = 0;
  }

  /** Samples recorded so far, oldest first. */
  get samples(): readonly DynamicPressureFrame[] {
    return this.frames;
  }

  get count(): number {
    return this.frames.length;
  }

  /** Takes one sample when the throttle and the animation state allow it. */
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

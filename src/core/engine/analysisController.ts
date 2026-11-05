import type { ClothSurface } from '../../render/clothSurface';
import type { FitStats } from '../../render/analysis/fit';
import type { StrainStats } from '../../render/analysis/strain';
import type { PressureStats } from '../../render/analysis/pressure';
import type {
  AnalysisChannel, AnalysisKind, AnalysisParams, AnalysisSource, AnalysisStats,
} from '../../render/analysis/channel';
import { fitChannel } from '../../render/analysis/fitChannel';
import { strainChannel } from '../../render/analysis/strainChannel';
import { pressureChannel } from '../../render/analysis/pressureChannel';

/** What the analysis passes read from the engine; nothing here mutates state. */
export interface AnalysisHost extends AnalysisSource {
  /** Shows or hides the cloth, its threads and trims underneath the heatmap. */
  revealCloth(visible: boolean): void;
}

/** Frames skipped between two passes of a channel; one pass every six frames. */
const REFRESH_FRAMES = 5;

/**
 * The three heatmap channels share one overlay and one vertex-colour attribute, so exactly one
 * is on at a time. The controller owns visibility and throttling; each channel owns its own
 * field computation and overlay write.
 */
export class AnalysisController {
  private surface: ClothSurface | null = null;
  /** Field computation and overlay write of each channel. */
  private readonly channels: { [K in AnalysisKind]: AnalysisChannel<K> } = {
    fit: fitChannel,
    strain: strainChannel,
    pressure: pressureChannel,
  };
  /** Channel currently shown. */
  private activeKind: AnalysisKind | null = null;
  /** Frames still skipped before the next pass of the active channel. */
  private countdown = 0;

  constructor(private readonly host: AnalysisHost) { }

  /** The shared cloth geometry is built with the fabric mesh; its overlay is ours to write. */
  attach(surface: ClothSurface): void {
    this.surface = surface;
  }

  /** The cloth is gone; the surface was disposed by the caller. */
  detach(): void {
    this.surface = null;
  }

  /** Turns every channel off without recomputing; used when the cloth itself is gone. */
  resetFlags(): void {
    this.activeKind = null;
    this.countdown = 0;
  }

  /** Clears the throttle and re-applies visibility after a cloth rebuild. */
  resetTimers(): void {
    this.countdown = 0;
    this.applyVisibility();
  }

  /** True while a channel is on, i.e. while the cloth itself is hidden. */
  get active(): boolean {
    return this.activeKind !== null;
  }

  /** Switches the cloth between fabric materials and the body-clearance heatmap. */
  setFit(enabled: boolean, tightCm: number, looseCm: number): FitStats | null {
    return this.activate('fit', enabled, { tightCm, looseCm });
  }

  /** Recomputes body clearance when the throttle allows; null when off or skipped. */
  refreshFit(tightCm: number, looseCm: number, force = false): FitStats | null {
    return this.refresh('fit', { tightCm, looseCm }, force);
  }

  /** Switches the cloth between fabric materials and the strain heatmap. */
  setStrain(enabled: boolean, min: number, max: number, byFabric = false): StrainStats | null {
    return this.activate('strain', enabled, { min, max, byFabric });
  }

  /** Recomputes per-vertex strain when the throttle allows; null when off or skipped. */
  refreshStrain(min: number, max: number, byFabric = false, force = false): StrainStats | null {
    return this.refresh('strain', { min, max, byFabric }, force);
  }

  /** Switches the cloth to the estimated contact-pressure heatmap. */
  setPressure(enabled: boolean, maxKpa: number): PressureStats | null {
    return this.activate('pressure', enabled, { maxKpa });
  }

  /** Converts the contact readback into an estimated pressure; null when off or skipped. */
  refreshPressure(maxKpa: number, force = false): PressureStats | null {
    return this.refresh('pressure', { maxKpa }, force);
  }

  /** Turns one channel on or off and reports its first summary when it comes on. */
  private activate<K extends AnalysisKind>(
    kind: K, enabled: boolean, params: AnalysisParams[K],
  ): AnalysisStats[K] | null {
    if (enabled) this.activeKind = kind;
    else if (this.activeKind === kind) this.activeKind = null;
    this.countdown = 0;
    this.applyVisibility();
    return enabled ? this.refresh(kind, params, true) : null;
  }

  /** Runs one pass of the active channel, at most once every REFRESH_FRAMES frames. */
  private refresh<K extends AnalysisKind>(
    kind: K, params: AnalysisParams[K], force = false,
  ): AnalysisStats[K] | null {
    if (this.activeKind !== kind || !this.surface) return null;
    if (!force && this.skipFrame()) return null;
    this.countdown = REFRESH_FRAMES;
    return this.channels[kind].pass(this.host, this.surface.overlay, params);
  }

  /** Consumes one skipped frame; true means this frame does no work. */
  private skipFrame(): boolean {
    if (this.countdown <= 0) return false;
    this.countdown -= 1;
    return true;
  }

  /** Shows or hides the shared overlay and the cloth drawn underneath it. */
  private applyVisibility(): void {
    const on = this.active;
    this.surface?.overlay.setVisible(on);
    this.host.revealCloth(!on);
  }
}

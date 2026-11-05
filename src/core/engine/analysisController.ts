import type { ClothSimInput } from '../../sim/simTypes';
import type { AvatarCollider } from '../../avatar/collider/avatarCollider';
import { FitOverlay } from '../../render/analysis/fitOverlay';
import { computeFitField, fitStats, type FitStats } from '../../render/analysis/fit';
import {
  computeVertexStrain, strainBounds, strainStats, type StrainBounds, type StrainStats,
} from '../../render/analysis/strain';
import { computePressureField, pressureStats, type PressureStats } from '../../render/analysis/pressure';

/**
 * What the analysis passes read from the engine. The overlay needs the live positions, the
 * body collider, the contact readback and the merged layout; nothing here mutates state.
 */
export interface AnalysisHost {
  /** Positions of the last frame that passed the finite check. */
  lastGoodPositions(): Float32Array;
  /** Initial merged positions, the fallback before the first step. */
  initialPositions(): Float32Array;
  /** Flat-pattern rest lengths of every merged particle, the strain denominator. */
  restPositions(): Float32Array;
  /** Merged layout: triangles, panels and their per-piece limits. Null when no cloth is built. */
  clothInput(): ClothSimInput | null;
  /** Body collider currently in the scene. */
  collider(): AvatarCollider | null;
  /** Contact indentation read back with the last step; null before the first step. */
  contact(): Float32Array | null;
  /** Shows or hides the cloth, its threads and trims underneath the heatmap. */
  revealCloth(visible: boolean): void;
}

/** Frames skipped between two passes of any channel; one pass every six frames. */
const REFRESH_FRAMES = 5;

/**
 * The three heatmap channels. They share one overlay and one vertex-colour attribute, so
 * exactly one channel is on at a time; each recomputes every sixth frame while it is on.
 */
export class AnalysisController {
  private overlay: FitOverlay | null = null;
  private fitVisible = false;
  private strainVisible = false;
  private pressureVisible = false;
  private fitCountdown = 0;
  private strainCountdown = 0;
  private pressureCountdown = 0;

  constructor(private readonly host: AnalysisHost) { }

  /** The overlay is created with the cloth geometry and handed over here. */
  attach(overlay: FitOverlay): void {
    this.overlay = overlay;
  }

  /** The cloth is gone; the overlay was disposed by the caller. */
  detach(): void {
    this.overlay = null;
  }

  /** Current overlay, for the caller that adds and removes its mesh. */
  get mesh(): FitOverlay | null {
    return this.overlay;
  }

  /** Repeats the heatmap material so per-panel geometry groups keep hiding hidden panels. */
  setSlotCount(count: number): void {
    this.overlay?.setSlotCount(count);
  }

  /** Turns every channel off without recomputing; used when the cloth itself is gone. */
  resetFlags(): void {
    this.fitVisible = false;
    this.strainVisible = false;
    this.pressureVisible = false;
    this.fitCountdown = 0;
    this.strainCountdown = 0;
    this.pressureCountdown = 0;
  }

  /** Clears the fit and strain throttles and re-applies visibility after a cloth rebuild. */
  resetTimers(): void {
    this.fitCountdown = 0;
    this.strainCountdown = 0;
    this.applyVisibility();
  }

  /** True while any channel is on, i.e. while the cloth itself is hidden. */
  get active(): boolean {
    return this.fitVisible || this.strainVisible || this.pressureVisible;
  }

  /**
   * Switches the cloth between fabric materials and the body-clearance heatmap.
   * Returns the first summary when turning the overlay on.
   */
  setFit(enabled: boolean, tightCm: number, looseCm: number): FitStats | null {
    if (enabled) {
      this.strainVisible = false;
      this.pressureVisible = false;
    }
    this.fitVisible = enabled;
    this.applyVisibility();
    this.fitCountdown = 0;
    return enabled ? this.refreshFit(tightCm, looseCm, true) : null;
  }

  /**
   * Recomputes body clearance on the live positions every few frames while the overlay is on.
   * Returns null when the overlay is off or this call was skipped by the throttle.
   */
  refreshFit(tightCm: number, looseCm: number, force = false): FitStats | null {
    if (!this.fitVisible || !this.overlay) return null;
    if (!force && this.skipFrame('fit')) return null;
    this.fitCountdown = REFRESH_FRAMES;
    const collider = this.host.collider();
    const initial = this.host.initialPositions();
    const lastGood = this.host.lastGoodPositions();
    const positions = lastGood.length === initial.length && initial.length > 0 ? lastGood : initial;
    if (!collider || positions.length === 0) return null;
    const field = computeFitField(positions, collider, { thresholds: { tightCm, looseCm } });
    this.overlay.update(field);
    return fitStats(field);
  }

  /**
   * Switches the cloth between fabric materials and the strain heatmap.
   * Returns the first summary when turning the overlay on.
   */
  setStrain(enabled: boolean, min: number, max: number, byFabric = false): StrainStats | null {
    if (enabled) {
      this.fitVisible = false;
      this.pressureVisible = false;
    }
    this.strainVisible = enabled;
    this.applyVisibility();
    this.strainCountdown = 0;
    return enabled ? this.refreshStrain(min, max, byFabric, true) : null;
  }

  /**
   * Recomputes per-vertex strain on the live positions every few frames while the overlay is on.
   * `byFabric` colours and counts against each panel's own strain limits instead of one range.
   */
  refreshStrain(min: number, max: number, byFabric = false, force = false): StrainStats | null {
    if (!this.strainVisible || !this.overlay || !this.host.clothInput()) return null;
    if (!force && this.skipFrame('strain')) return null;
    this.strainCountdown = REFRESH_FRAMES;
    const rest = this.host.restPositions();
    const lastGood = this.host.lastGoodPositions();
    const positions = lastGood.length === rest.length && rest.length > 0 ? lastGood : rest;
    if (rest.length === 0 || positions.length === 0) return null;
    const indices = this.host.clothInput()!.indices;
    const strain = computeVertexStrain(rest, positions, indices);
    const bounds = byFabric ? this.strainBoundsOfMergedCloth() : undefined;
    const stats = strainStats(strain, bounds);
    if (bounds) this.overlay.updateStrainBounds(strain, bounds);
    else this.overlay.updateStrain(strain, min, max);
    return stats;
  }

  /**
   * Switches the cloth to the estimated contact-pressure heatmap.
   * Returns the first summary when turning the overlay on.
   */
  setPressure(enabled: boolean, maxKpa: number): PressureStats | null {
    if (enabled) {
      this.fitVisible = false;
      this.strainVisible = false;
    }
    this.pressureVisible = enabled;
    this.applyVisibility();
    this.pressureCountdown = 0;
    return enabled ? this.refreshPressure(maxKpa, true) : null;
  }

  /**
   * Converts the contact indentation read back with the latest step into an estimated pressure.
   * Returns null when the overlay is off or this call was skipped by the throttle.
   */
  refreshPressure(maxKpa: number, force = false): PressureStats | null {
    const contact = this.host.contact();
    if (!this.pressureVisible || !this.overlay || !contact) return null;
    if (!force && this.skipFrame('pressure')) return null;
    this.pressureCountdown = REFRESH_FRAMES;
    const field = computePressureField(contact);
    const panels = this.host.clothInput()?.panels.map(panel => ({
      panelId: panel.panelId,
      vertexOffset: panel.vertexOffset,
      vertexCount: panel.mesh.vertexCount,
    })) ?? [];
    this.overlay.updatePressure(field.pressureKpa, maxKpa);
    return pressureStats(field, panels);
  }

  /** Decrements one channel's countdown; true means this frame is skipped. */
  private skipFrame(channel: 'fit' | 'strain' | 'pressure'): boolean {
    const remaining = channel === 'fit'
      ? this.fitCountdown
      : channel === 'strain' ? this.strainCountdown : this.pressureCountdown;
    if (remaining <= 0) return false;
    if (channel === 'fit') this.fitCountdown = remaining - 1;
    else if (channel === 'strain') this.strainCountdown = remaining - 1;
    else this.pressureCountdown = remaining - 1;
    return true;
  }

  /** Shows or hides the shared overlay and the cloth drawn underneath it. */
  private applyVisibility(): void {
    const on = this.active;
    this.overlay?.setVisible(on);
    this.host.revealCloth(!on);
  }

  /** Per-vertex strain tolerance from every panel's fabric in the merged layout. */
  private strainBoundsOfMergedCloth(): StrainBounds | undefined {
    const input = this.host.clothInput();
    if (!input) return undefined;
    return strainBounds(input.particleCount, input.panels.map(panel => ({
      vertexOffset: panel.vertexOffset,
      vertexCount: panel.mesh.vertexCount,
      stretchLimit: panel.physics.stretchLimit,
      compressionLimit: panel.physics.compressionLimit,
    })));
  }
}

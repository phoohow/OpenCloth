/** Fit, strain and pressure heatmaps: scalar fields written into the cloth mesh. */

import type { DisplayOverride } from '@/render/common';
import { CHANNEL_RASTER } from '@/render/common';
import {
  computeFitField, fitStats, type FitStats,
  computePressureField, pressureStats, type PressureStats,
  computeVertexStrain, strainBounds, strainStats, type StrainBounds, type StrainStats,
} from '@/analysis';
import type { ClothSimInput } from '@/sim';
import type { AvatarCollider } from '@/avatar/collider';
import type { ClothPresenter } from '@/runtime/presenters/clothPresenter';

/** Scalar field a heatmap channel visualizes. */
export type AnalysisKind = 'fit' | 'strain' | 'pressure';

/** What the analysis presenter reads from the engine. */
export interface AnalysisDeps {
  /** The drawn garment whose field stream receives the active channel. */
  cloth: () => ClothPresenter | null;
  lastGoodPositions: () => Float32Array;
  initialPositions: () => Float32Array;
  restPositions: () => Float32Array;
  clothInput: () => ClothSimInput | null;
  collider: () => AvatarCollider | null;
  contact: () => Float32Array | null;
}

/** Palettes and value ranges of the three channels. */
const PALETTES: Record<AnalysisKind, readonly string[]> = {
  fit: ['#d91e1e', '#33bf40', '#3373e6'],
  strain: ['#2244ff', '#ffffff', '#ff2d2d'],
  pressure: ['#f2f2f2', '#ffd166', '#e03a3a'],
};

/** Frames skipped between two passes of a channel. */
const REFRESH_FRAMES = 5;

/** Owns the active heatmap, its throttle and the display override that shows it. */
export class AnalysisPresenter {
  private activeKind: AnalysisKind | null = null;
  private countdown = 0;
  private range = { min: 0, max: 1 };
  private fitParams = { tightCm: 0.5, looseCm: 2 };
  private strainParams = { min: -0.25, max: 0.25, byFabric: false };
  private pressureParams = { maxKpa: 4 };

  constructor(private readonly deps: AnalysisDeps) { }

  /** True while a heatmap replaces the cloth surface. */
  get active(): boolean {
    return this.activeKind !== null;
  }

  /** Display rule the viewport adds while a channel is on. */
  override(): DisplayOverride | null {
    const kind = this.activeKind;
    if (!kind) return null;
    return {
      tags: ['subjectSurface'],
      technique: 'heatmap',
      channels: CHANNEL_RASTER,
      stage: 'postTone',
      mode: 'replace',
      params: {
        heatmap: { palette: PALETTES[kind], min: this.range.min, max: this.range.max },
      },
    };
  }

  /** Clears the throttle and reruns the active channel after a cloth rebuild. */
  resetTimers(): void {
    this.countdown = 0;
    if (!this.activeKind) return;
    if (this.activeKind === 'fit') this.refreshFit(this.fitParams.tightCm, this.fitParams.looseCm, true);
    else if (this.activeKind === 'strain') {
      this.refreshStrain(this.strainParams.min, this.strainParams.max, this.strainParams.byFabric, true);
    } else this.refreshPressure(this.pressureParams.maxKpa, true);
  }

  /** Turns every channel off without recomputing; used when the cloth itself is gone. */
  resetFlags(): void {
    if (this.activeKind) this.deps.cloth()?.clearField();
    this.activeKind = null;
    this.countdown = 0;
  }

  setFit(enabled: boolean, tightCm: number, looseCm: number): FitStats | null {
    this.fitParams = { tightCm, looseCm };
    return this.activate('fit', enabled, () => this.refreshFit(tightCm, looseCm, true));
  }

  refreshFit(tightCm: number, looseCm: number, force = false): FitStats | null {
    if (!this.starts('fit', force)) return null;
    const collider = this.deps.collider();
    const positions = liveOr(this.deps.initialPositions(), this.deps.lastGoodPositions());
    if (!collider || positions.length === 0) return null;
    const field = computeFitField(positions, collider, { thresholds: { tightCm, looseCm } });
    this.range = { min: Math.min(-1, tightCm), max: Math.max(looseCm * 2, 1) };
    this.write(field.clearanceCm);
    return fitStats(field);
  }

  setStrain(enabled: boolean, min: number, max: number, byFabric = false): StrainStats | null {
    this.strainParams = { min, max, byFabric };
    return this.activate('strain', enabled, () => this.refreshStrain(min, max, byFabric, true));
  }

  refreshStrain(min: number, max: number, byFabric = false, force = false): StrainStats | null {
    if (!this.starts('strain', force)) return null;
    const input = this.deps.clothInput();
    if (!input) return null;
    const rest = this.deps.restPositions();
    const positions = liveOr(rest, this.deps.lastGoodPositions());
    if (rest.length === 0 || positions.length === 0) return null;
    const strain = computeVertexStrain(rest, positions, input.indices);
    const bounds = byFabric ? boundsOfAssembly(input) : undefined;
    this.range = { min, max };
    this.write(strain);
    return strainStats(strain, bounds);
  }

  setPressure(enabled: boolean, maxKpa: number): PressureStats | null {
    this.pressureParams = { maxKpa };
    return this.activate('pressure', enabled, () => this.refreshPressure(maxKpa, true));
  }

  refreshPressure(maxKpa: number, force = false): PressureStats | null {
    if (!this.starts('pressure', force)) return null;
    const contact = this.deps.contact();
    if (!contact) return null;
    const field = computePressureField(contact);
    const panels = this.deps.clothInput()?.panels.map(panel => ({
      panelId: panel.panelId,
      vertexOffset: panel.vertexOffset,
      vertexCount: panel.mesh.vertexCount,
    })) ?? [];
    this.range = { min: 0, max: Math.max(maxKpa, 1e-3) };
    this.write(field.pressureKpa);
    return pressureStats(field, panels);
  }

  /** Turns one channel on or off and reports its first summary when it comes on. */
  private activate<T>(kind: AnalysisKind, enabled: boolean, first: () => T | null): T | null {
    if (enabled) {
      this.activeKind = kind;
    } else if (this.activeKind === kind) {
      this.activeKind = null;
      this.deps.cloth()?.clearField();
    }
    this.countdown = 0;
    return enabled ? first() : null;
  }

  /** Whether this pass may run now and owns the cloth field. */
  private starts(kind: AnalysisKind, force: boolean): boolean {
    if (this.activeKind !== kind) return false;
    if (!force && this.countdown > 0) {
      this.countdown -= 1;
      return false;
    }
    this.countdown = REFRESH_FRAMES;
    return true;
  }

  /** Replaces non-finite samples so the palette stays defined. */
  private write(values: Float32Array): void {
    const field = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!;
      field[i] = Number.isFinite(value) ? value : 0;
    }
    this.deps.cloth()?.setField(field);
  }
}

/** Live positions when they match the rest layout, else the fallback. */
function liveOr(rest: Float32Array, fallback: Float32Array): Float32Array {
  if (fallback.length === rest.length && fallback.length > 0) return fallback;
  return rest;
}

/** Per-vertex strain tolerance from every panel's fabric in the merged layout. */
function boundsOfAssembly(input: ClothSimInput): StrainBounds {
  return strainBounds(input.particleCount, input.panels.map(panel => ({
    vertexOffset: panel.vertexOffset,
    vertexCount: panel.mesh.vertexCount,
    stretchLimit: panel.physics.stretchLimit,
    compressionLimit: panel.physics.compressionLimit,
  })));
}
